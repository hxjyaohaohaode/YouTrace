"""Real supervisor -> Prisma -> Hono HTTP -> backup -> restore, synthetic only.
No Docker, Nginx, TLS/browser cookie enforcement or real SMS/model coverage.
Every Node child has a locked, deny-all fetch preload; attempted calls fail tests.
"""
from contextlib import closing
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

LOCAL = Path(__file__).resolve().parents[1]
ROOT = LOCAL.parents[1]
SERVER = ROOT / 'youji-app/server'
sys.path.insert(0, str(LOCAL))
import storage


class RuntimeFixture:
    """Disposable real processes and databases; never inherits provider credentials."""
    def __init__(self, case, root):
        self.case, self.root = case, Path(root)
        self.data = self.root / 'data'; self.data.mkdir()
        self.backups = self.root / 'backups'; self.backups.mkdir()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); self.port = sock.getsockname()[1]
        self.fetch_attempts = self.root / 'outbound-fetch-attempts.log'
        guard = self.root / 'deny-fetch.cjs'
        guard.write_text("""const fs = require('node:fs');
Object.defineProperty(globalThis, 'fetch', {
  configurable: false, writable: false,
  value: async () => {
    fs.appendFileSync(process.env.YOU_TRACE_FETCH_ATTEMPTS, 'blocked fetch\\n');
    throw new Error('Synthetic runtime test forbids all outbound fetch');
  }
});
""")
        self.env = {name: os.environ[name] for name in
                    ('PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH')
                    if name in os.environ}
        self.env.update(NODE_ENV='production',
                        JWT_SECRET='synthetic-runtime-test-secret-never-release-12345',
                        ALLOWED_ORIGINS='https://localhost:8443', HOST='127.0.0.1', PORT=str(self.port),
                        SMS_PROVIDER_URL='https://sms.example.invalid/send', SMS_PROVIDER_TOKEN='synthetic-no-call',
                        AI_CREDENTIAL_ENCRYPTION_KEY='ERERERERERERERERERERERERERERERERERERERERERE=',
                        DATA_DIR=str(self.data), DATABASE_URL='file:' + str(self.data / storage.DB_NAME),
                        BACKUP_DIR=str(self.backups), YOU_TRACE_INITIALIZE_EMPTY='true', DEV_OTP_EXPOSE='false',
                        TRUST_PROXY='false', SERVER_AI_ENABLED='false', CHECKPOINT_DISABLE='1',
                        DOTENV_CONFIG_PATH=str(self.root / 'absent-synthetic.env'),
                        NODE_OPTIONS='--require=' + str(guard), YOU_TRACE_FETCH_ATTEMPTS=str(self.fetch_attempts))
        self.processes = []

    def run(self, command, env=None, timeout=30, cwd=SERVER):
        return subprocess.run(command, cwd=cwd, env=self.env if env is None else env,
                              capture_output=True, text=True, timeout=timeout)

    def node(self, script, env=None):
        result = self.run(['node', '--input-type=module', '-e', script], env)
        self.case.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def start(self, env=None, managed=True):
        log = (self.root / ('run-' + str(len(self.processes)) + '.log')).open('w+')
        command = [sys.executable, str(LOCAL / 'runtime.py')] if managed else ['node', 'dist/index.js']
        child = subprocess.Popen(command, cwd=SERVER, env=self.env if env is None else env,
                                 stdout=log, stderr=log)
        self.processes.append((child, log))
        for _ in range(200):
            if child.poll() is not None:
                log.seek(0); self.case.fail('Server exited: ' + log.read())
            try:
                with urlopen(f'http://127.0.0.1:{self.port}/health', timeout=1) as response:
                    if response.status == 200:
                        return child
            except (URLError, TimeoutError):
                pass
            time.sleep(.1)
        self.case.fail('API did not become ready')

    def stop(self, child):
        child.terminate()
        self.case.assertEqual(child.wait(timeout=15), 0)

    def request(self, path, token='', value=None, origin='https://localhost:8443', method=None, raw=False):
        headers = {'Cookie': 'youji_session=' + token, 'Origin': origin, 'Content-Type': 'application/json'}
        req = Request(f'http://127.0.0.1:{self.port}' + path, headers=headers,
                      data=None if value is None else json.dumps(value).encode(), method=method)
        try:
            response = urlopen(req, timeout=5)
        except HTTPError as response_error:
            response = response_error
        with response:
            body = response.read().decode()
            return response.status, body if raw else json.loads(body), response.headers

    def close(self):
        for child, log in self.processes:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
            log.close()
        self.case.assertFalse(self.fetch_attempts.exists(), 'A Node child attempted an outbound fetch')


class RuntimeChain(unittest.TestCase):
    def test_migrate_lock_http_backup_restart_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            fixture = RuntimeFixture(self, tmp)
            env, data, backups = fixture.env, fixture.data, fixture.backups
            request = fixture.request

            def verify_ai_copy(directory, expected_cipher=None):
                with closing(storage.connect_readonly(directory / storage.DB_NAME)) as db:
                    row = db.execute('SELECT "userId", "providerId", "model", "cipher", "version", "chatConsent" FROM "UserAIConnection"').fetchone()
                self.assertEqual(row[:3], ('synthetic-runtime-owner', 'deepseek', 'synthetic-test-model'))
                self.assertEqual(row[4:], (1, 0))
                self.assertNotIn('synthetic-durable-api-key-never-valid', row[3])
                if expected_cipher is not None:
                    self.assertEqual(row[3], expected_cipher)
                # Verify restored ciphertext with the original fixture key using
                # Node crypto; the real application failure paths are checked below.
                check = '''import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
const { prisma } = await import('./dist/utils/db.js');
const { completeUserAI } = await import('./dist/services/userAI.js');
try {
  const row = await prisma.userAIConnection.findUniqueOrThrow({where:{userId:'synthetic-runtime-owner'}});
  const [version, iv, tag, body] = row.cipher.split('.');
  assert.equal(version, 'v1');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.AI_CREDENTIAL_ENCRYPTION_KEY, 'base64'), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from('youtrace:user-ai:v1:synthetic-runtime-owner:deepseek'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(), 'synthetic-durable-api-key-never-valid');
  const run = async () => { for await (const _ of completeUserAI(row, [{role:'user',content:'Synthetic fixture'}], new AbortController().signal, true)) {} };
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=';
  await assert.rejects(run, error => error.code === 'AI_CREDENTIALS_UNAVAILABLE');
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  await assert.rejects(run, error => error.code === 'AI_CREDENTIAL_STORAGE_UNAVAILABLE');
} finally { await prisma.$disconnect(); }
'''
                fixture.node(check, dict(env, DATABASE_URL='file:' + str(directory / storage.DB_NAME)))
                return row[3]

            try:
                first = fixture.start()
                self.assertTrue((data / storage.INSTALL).exists())
                duplicate = fixture.run([sys.executable, str(LOCAL / 'runtime.py')])
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertIn('Another managed process', duplicate.stderr)
                token = fixture.node('''import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
const db = new PrismaClient();
await db.user.create({data:{id:'synthetic-runtime-owner',phone:'13800000000',nickname:'Synthetic'}});
console.log(jwt.sign({id:'synthetic-runtime-owner',phone:'13800000000'},process.env.JWT_SECRET,
{algorithm:'HS256',issuer:'youji-server',audience:'youji-web',subject:'synthetic-runtime-owner',expiresIn:'1h'}));
await db.$disconnect();''')
                self.assertEqual(request('/api/todos', value={'text':'blocked'}, token=token, origin='https://invalid.example')[0], 403)
                self.assertEqual(request('/api/todos')[0], 401)
                status, created, _ = request('/api/todos', value={'text':'persist after restart'}, token=token)
                self.assertEqual(status, 201)
                todo_id = created['todo']['id']
                status, ai, _ = request('/api/ai-connection', token=token, method='PUT', value={
                    'connectionId':None, 'version':0, 'providerId':'deepseek', 'model':'synthetic-test-model',
                    'apiKey':'synthetic-durable-api-key-never-valid', 'chatConsent':False})
                self.assertEqual(status, 200)
                self.assertEqual(ai['connection']['connectivity'], 'not_tested')
                self.assertNotIn('cipher', ai['connection'])
                self.assertNotIn('apiKey', ai['connection'])
                original_cipher = verify_ai_copy(data)
                output = backups / 'online.sqlite3'
                storage.snapshot(data / storage.DB_NAME, output)
                with closing(storage.connect_readonly(output)) as db:
                    self.assertEqual(db.execute('SELECT cipher FROM "UserAIConnection"').fetchone()[0], original_cipher)
                self.assertNotIn(env['AI_CREDENTIAL_ENCRYPTION_KEY'].encode(), output.read_bytes())
                fixture.stop(first)
                restarted = fixture.start(dict(env, YOU_TRACE_INITIALIZE_EMPTY='false'))
                self.assertEqual(request('/api/todos', token=token)[1]['todos'][0]['id'], todo_id)
                verify_ai_copy(data, original_cipher)
                self.assertEqual(request('/api/ai-connection', token=token)[1]['connection'], ai['connection'])
                self.assertTrue(list(backups.glob('prestart-*.sqlite3.json')))
                fixture.stop(restarted)
                target = Path(tmp) / 'restored'
                storage.restore(output, target)
                restored_env = dict(env, DATA_DIR=str(target), DATABASE_URL='file:' + str(target / storage.DB_NAME),
                                    YOU_TRACE_INITIALIZE_EMPTY='false')
                restored = fixture.start(restored_env)
                self.assertEqual(request('/api/todos', token=token)[1]['todos'][0]['id'], todo_id)
                verify_ai_copy(target, original_cipher)
                self.assertEqual(request('/api/ai-connection', token=token)[1]['connection'], ai['connection'])
                with closing(storage.connect_readonly(target / storage.DB_NAME)) as db:
                    self.assertGreater(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'").fetchone()[0], 10)
                    self.assertGreater(db.execute('SELECT COUNT(*) FROM "SyncChange"').fetchone()[0], 0)
                fixture.stop(restored)

                for key, expected_error in (
                        ('IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=', 'AI_CREDENTIALS_UNAVAILABLE'),
                        (None, 'AI_CREDENTIAL_STORAGE_UNAVAILABLE')):
                    with self.subTest(encryption_key='missing' if key is None else 'wrong'):
                        unavailable_env = dict(restored_env)
                        if key is None:
                            unavailable_env.pop('AI_CREDENTIAL_ENCRYPTION_KEY')
                        else:
                            unavailable_env['AI_CREDENTIAL_ENCRYPTION_KEY'] = key
                        unavailable = fixture.start(unavailable_env)
                        connection = ai['connection']
                        status, result, _ = request('/api/ai-connection/probe', token=token, value={
                            'connectionId': connection['connectionId'], 'version': connection['version'],
                            'confirmProviderCharge': True})
                        self.assertEqual((status, result), (503, {'error': expected_error}))
                        status, created, _ = request('/api/todos', token=token, value={'text':'AI-independent CRUD'})
                        self.assertEqual(status, 201)
                        item = created['todo']['id']
                        self.assertEqual(request('/api/todos/' + item, token=token, method='PUT', value={'text':'updated safely'})[0], 200)
                        self.assertIn(item, [row['id'] for row in request('/api/todos', token=token)[1]['todos']])
                        self.assertEqual(request('/api/todos/' + item, token=token, method='DELETE')[0], 200)
                        self.assertNotIn(item, [row['id'] for row in request('/api/todos', token=token)[1]['todos']])
                        status, body, _ = request('/api/chat', token=token, value={'message':'你好'}, raw=True)
                        self.assertEqual(status, 200)
                        self.assertIn('"source":"rule_fallback"', body)
                        self.assertIn('data: [DONE]', body)
                        self.assertNotIn('synthetic-durable-api-key-never-valid', body)
                        with closing(storage.connect_readonly(target / storage.DB_NAME)) as db:
                            self.assertEqual(db.execute('SELECT cipher FROM "UserAIConnection"').fetchone()[0], original_cipher)
                            self.assertGreater(db.execute("SELECT COUNT(*) FROM ChatMessage WHERE role='assistant' AND source='rule_fallback'").fetchone()[0], 0)
                        fixture.stop(unavailable)

                final = fixture.start(restored_env)
                status, result, headers = request('/api/auth/logout', token=token, method='POST')
                self.assertEqual((status, result), (200, {'success': True}))
                cookie = headers.get('Set-Cookie', '').lower()
                for flag in ('youji_session=', 'httponly', 'secure', 'samesite=none'):
                    self.assertIn(flag, cookie)
                self.assertEqual(request('/api/todos', token=token)[0], 401)
                fixture.stop(final)
                revoked = fixture.start(restored_env)
                self.assertEqual(request('/api/todos', token=token)[0], 401)
                self.assertEqual(request('/api/auth/me', token=token)[0], 401)
                verify_ai_copy(target, original_cipher)
                fixture.stop(revoked)
            finally:
                fixture.close()


if __name__ == '__main__':
    unittest.main()
