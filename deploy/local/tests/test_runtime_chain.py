"""Real Linux supervisor -> Prisma -> Hono HTTP -> backup -> restore.
Synthetic account/session are installed directly, not sent through an SMS provider.
Does not claim Docker, Nginx, TLS/browser cookie enforcement or real SMS coverage.
"""
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

class RuntimeChain(unittest.TestCase):
    def test_migrate_lock_http_backup_restart_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            temp = Path(tmp)
            data = temp / 'data'; data.mkdir()
            backups = temp / 'backups'; backups.mkdir()
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
            env = dict(os.environ, NODE_ENV='production',
                       JWT_SECRET='synthetic-runtime-test-secret-never-release-12345',
                       ALLOWED_ORIGINS='https://localhost:8443', HOST='127.0.0.1', PORT=str(port),
                       SMS_PROVIDER_URL='https://sms.example.invalid/send', SMS_PROVIDER_TOKEN='synthetic-no-call',
                       AI_CREDENTIAL_ENCRYPTION_KEY='ERERERERERERERERERERERERERERERERERERERERERE=',
                       DATA_DIR=str(data), DATABASE_URL='file:' + str(data / storage.DB_NAME),
                       BACKUP_DIR=str(backups), YOU_TRACE_INITIALIZE_EMPTY='true', DEV_OTP_EXPOSE='false')
            # Explicitly do not inherit any model-provider secrets into this synthetic test.
            for name in ('LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'):
                env.pop(name, None)
            processes = []
            def start(config):
                log = (temp / ('run-' + str(len(processes)) + '.log')).open('w+')
                child = subprocess.Popen([sys.executable, str(LOCAL / 'runtime.py')],
                                         cwd=SERVER, env=config, stdout=log, stderr=log)
                processes.append((child, log))
                for _ in range(200):
                    if child.poll() is not None:
                        log.seek(0); self.fail('Supervisor exited: ' + log.read())
                    try:
                        with urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response:
                            if response.status == 200: return child
                    except (URLError, TimeoutError): pass
                    time.sleep(.1)
                self.fail('API did not become ready')
            def request(path, token='', value=None, origin='https://localhost:8443', method=None):
                headers = {'Cookie': 'youji_session=' + token, 'Origin':origin, 'Content-Type':'application/json'}
                req = Request(f'http://127.0.0.1:{port}' + path, headers=headers,
                              data=None if value is None else json.dumps(value).encode(), method=method)
                try: response = urlopen(req, timeout=5)
                except HTTPError as response_error: response = response_error
                with response: return response.status, json.load(response)
            def verify_ai_copy(directory, expected_cipher=None):
                # The fixture key is fixed public test data. No production key is generated.
                with storage.connect_readonly(directory / storage.DB_NAME) as db:
                    row = db.execute('SELECT "userId", "providerId", "model", "cipher", "version", "chatConsent" FROM "UserAIConnection"').fetchone()
                    self.assertEqual(row[:3], ('synthetic-runtime-owner', 'deepseek', 'synthetic-test-model'))
                    self.assertEqual(row[4:], (1, 0))
                    self.assertNotIn('synthetic-durable-api-key-never-valid', row[3])
                    if expected_cipher is not None: self.assertEqual(row[3], expected_cipher)
                # Exercise the actual application decrypt path with an in-process fetch
                # substitute. It cannot call the provider, including on a wrong/missing key.
                check = '''import assert from 'node:assert/strict';
const { prisma } = await import('./dist/utils/db.js');
const { completeUserAI } = await import('./dist/services/userAI.js');
const row = await prisma.userAIConnection.findUniqueOrThrow({where:{userId:'synthetic-runtime-owner'}});
let calls = 0;
globalThis.fetch = async (_url, options) => {
  calls += 1;
  assert.equal(options.headers.Authorization, 'Bearer synthetic-durable-api-key-never-valid');
  return new Response('data: {"choices":[{"delta":{"content":"synthetic-ok"}}]}\\n\\ndata: [DONE]\\n\\n');
};
const run = async () => { let text = ''; for await (const value of completeUserAI(row, [{role:'user',content:'Synthetic fixture'}], new AbortController().signal, true)) text += value; return text; };
try {
  assert.equal(await run(), 'synthetic-ok'); assert.equal(calls, 1);
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = 'IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=';
  await assert.rejects(run, error => error.code === 'AI_CREDENTIALS_UNAVAILABLE');
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  await assert.rejects(run, error => error.code === 'AI_CREDENTIAL_STORAGE_UNAVAILABLE');
  assert.equal(calls, 1);
} finally { await prisma.$disconnect(); }
'''
                subprocess.run(['node', '--input-type=module', '-e', check], cwd=SERVER,
                               env=dict(env, DATABASE_URL='file:' + str(directory / storage.DB_NAME)),
                               capture_output=True, text=True, timeout=15, check=True)
                return row[3]
            try:
                first = start(env)
                self.assertTrue((data / storage.INSTALL).exists())
                duplicate = subprocess.run([sys.executable, str(LOCAL / 'runtime.py')], cwd=SERVER,
                                           env=env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertIn('Another managed process', duplicate.stderr)
                setup = '''import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
const db = new PrismaClient();
await db.user.create({data:{id:'synthetic-runtime-owner',phone:'13800000000',nickname:'Synthetic'}});
console.log(jwt.sign({id:'synthetic-runtime-owner',phone:'13800000000'},process.env.JWT_SECRET,
{algorithm:'HS256',issuer:'youji-server',audience:'youji-web',subject:'synthetic-runtime-owner',expiresIn:'1h'}));
await db.$disconnect();'''
                token = subprocess.check_output(['node', '--input-type=module', '-e', setup], cwd=SERVER,
                                                env=env, text=True, timeout=15).strip()
                self.assertEqual(request('/api/todos', value={'text':'blocked'}, token=token, origin='https://invalid.example')[0], 403)
                self.assertEqual(request('/api/todos')[0], 401)
                status, created = request('/api/todos', value={'text':'persist after restart'}, token=token)
                self.assertEqual(status, 201)
                todo_id = created['todo']['id']
                status, ai = request('/api/ai-connection', token=token, method='PUT', value={
                    'connectionId':None, 'version':0, 'providerId':'deepseek', 'model':'synthetic-test-model',
                    'apiKey':'synthetic-durable-api-key-never-valid', 'chatConsent':False})
                self.assertEqual(status, 200)
                self.assertEqual(ai['connection']['connectivity'], 'not_tested')
                self.assertNotIn('cipher', ai['connection'])
                self.assertNotIn('apiKey', ai['connection'])
                original_cipher = verify_ai_copy(data)
                output = backups / 'online.sqlite3'
                storage.snapshot(data / storage.DB_NAME, output)
                with storage.connect_readonly(output) as db:
                    self.assertEqual(db.execute('SELECT cipher FROM "UserAIConnection"').fetchone()[0], original_cipher)
                self.assertNotIn(env['AI_CREDENTIAL_ENCRYPTION_KEY'].encode(), output.read_bytes())
                first.terminate(); self.assertEqual(first.wait(timeout=15), 0)
                restarted = start(dict(env, YOU_TRACE_INITIALIZE_EMPTY='false'))
                status, content = request('/api/todos', token=token)
                self.assertEqual(status, 200)
                self.assertEqual(content['todos'][0]['id'], todo_id)
                verify_ai_copy(data, original_cipher)
                self.assertEqual(request('/api/ai-connection', token=token)[1]['connection'], ai['connection'])
                self.assertTrue(list(backups.glob('prestart-*.sqlite3.json')))
                restarted.terminate(); self.assertEqual(restarted.wait(timeout=15), 0)
                target = temp / 'restored'
                storage.restore(output, target)
                restored = start(dict(env, DATA_DIR=str(target), DATABASE_URL='file:' + str(target / storage.DB_NAME),
                                      YOU_TRACE_INITIALIZE_EMPTY='false'))
                status, content = request('/api/todos', token=token)
                self.assertEqual(status, 200)
                self.assertEqual(content['todos'][0]['id'], todo_id)
                verify_ai_copy(target, original_cipher)
                self.assertEqual(request('/api/ai-connection', token=token)[1]['connection'], ai['connection'])
                # Runtime migrations install the actual SQLite sync trigger chain.
                with storage.connect_readonly(target / storage.DB_NAME) as db:
                    self.assertGreater(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'").fetchone()[0], 10)
                    self.assertGreater(db.execute('SELECT COUNT(*) FROM "SyncChange"').fetchone()[0], 0)
                restored.terminate(); self.assertEqual(restored.wait(timeout=15), 0)
            finally:
                for child, log in processes:
                    if child.poll() is None:
                        child.terminate()
                        try: child.wait(timeout=10)
                        except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=5)
                    log.close()

if __name__ == '__main__': unittest.main()
