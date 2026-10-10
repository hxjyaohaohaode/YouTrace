import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runtime
import storage

class LocalStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / storage.DB_NAME
        self.db = sqlite3.connect(self.source)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE item (id INTEGER PRIMARY KEY, value TEXT)')
        self.db.execute("INSERT INTO item VALUES (1, 'synthetic-private')")
        self.db.commit()
    def tearDown(self):
        self.db.close()
        self.temp.cleanup()
    def test_online_backup_includes_wal_and_restores_new_directory(self):
        self.assertTrue(Path(str(self.source) + '-wal').exists())
        output = self.root / 'snapshot.sqlite3'
        storage.snapshot(self.source, output)
        target = self.root / 'restore'
        storage.restore(output, target)
        storage.require_install(target)
        with sqlite3.connect(target / storage.DB_NAME) as conn:
            self.assertEqual(conn.execute('SELECT value FROM item').fetchone()[0], 'synthetic-private')
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
    def test_refuse_source_overwrite(self):
        with self.assertRaises(ValueError): storage.snapshot(self.source, self.source)
    def test_refuse_existing_target_and_all_sidecars(self):
        for suffix in ['', '.json', '-wal', '-shm', '-journal']:
            with self.subTest(suffix=suffix):
                target = self.root / ('target' + str(len(suffix)))
                sidecar = Path(str(target) + suffix)
                sidecar.write_text('do not overwrite')
                with self.assertRaises(ValueError): storage.snapshot(self.source, target)
                self.assertEqual(sidecar.read_text(), 'do not overwrite')
                sidecar.unlink()
    def test_refuse_symlink_source(self):
        link = self.root / 'link'
        link.symlink_to(self.source)
        with self.assertRaises(ValueError): storage.snapshot(link, self.root / 'out')
    def test_restore_rejects_modified_bytes(self):
        output = self.root / 'snapshot'
        storage.snapshot(self.source, output)
        with output.open('ab') as stream: stream.write(b'tampered')
        with self.assertRaises(ValueError): storage.restore(output, self.root / 'restored')
        self.assertFalse((self.root / 'restored' / storage.INSTALL).exists())
    def test_backup_is_sealed_without_wal_sidecars(self):
        output = self.root / 'sealed'
        storage.snapshot(self.source, output)
        for suffix in ('-wal', '-shm', '-journal'):
            self.assertFalse(Path(str(output) + suffix).exists())
        with storage.connect_readonly(output) as conn:
            self.assertEqual(conn.execute('PRAGMA journal_mode').fetchone()[0], 'delete')
    def test_restore_rejects_active_sidecars(self):
        output = self.root / 'sealed'
        storage.snapshot(self.source, output)
        Path(str(output) + '-wal').touch()
        with self.assertRaises(ValueError): storage.restore(output, self.root / 'recover')
        self.assertFalse((self.root / 'recover').exists())
    def test_restore_never_overwrites_existing_directory(self):
        output = self.root / 'snapshot'
        storage.snapshot(self.source, output)
        with self.assertRaises(FileExistsError): storage.restore(output, self.root)
    def test_reject_missing_source_does_not_create_empty_database(self):
        missing = self.root / 'missing'
        with self.assertRaises(ValueError): storage.snapshot(missing, self.root / 'out')
        self.assertFalse(missing.exists())
    def test_reject_foreign_key_corruption(self):
        self.db.execute('CREATE TABLE child (parent INTEGER REFERENCES item(id))')
        self.db.execute('INSERT INTO child VALUES (99)')
        self.db.commit()
        with self.assertRaises(ValueError): storage.snapshot(self.source, self.root / 'bad')
    def test_no_unknown_install_auto_enrollment(self):
        with self.assertRaises(ValueError): runtime.prepare_data(self.root, True)
        with self.assertRaises(ValueError): runtime.prepare_data(self.root, False)
    def test_empty_initialization_is_explicit(self):
        target = self.root / 'new'
        target.mkdir()
        with self.assertRaises(ValueError): runtime.prepare_data(target, False)
        (target / '.runtime.lock').touch()
        self.assertFalse(runtime.prepare_data(target, True))
    def test_marker_does_not_replace_missing_database(self):
        target = self.root / 'new'
        target.mkdir()
        storage.make_marker(target)
        with self.assertRaises(ValueError): runtime.prepare_data(target, True)
    def test_existing_installation_accepted_without_initialize_flag(self):
        storage.make_marker(self.root)
        self.assertTrue(runtime.prepare_data(self.root, False))
    def test_invalid_marker_rejected(self):
        (self.root / storage.INSTALL).write_text('{}')
        with self.assertRaises(ValueError): storage.require_install(self.root)

class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = {'NODE_ENV':'production', 'JWT_SECRET':'synthetic-test-secret-not-for-release-123456',
                    'ALLOWED_ORIGINS':'https://localhost:8443', 'DATA_DIR': self.temp.name,
                    'SMS_PROVIDER_URL':'https://sms.example.invalid/send', 'SMS_PROVIDER_TOKEN':'synthetic-no-call'}
    def tearDown(self): self.temp.cleanup()
    def test_valid_config(self):
        self.assertEqual(runtime.validate_environment(self.env), Path(self.temp.name))
    def test_reject_invalid_configs(self):
        changes = [('NODE_ENV','development'), ('JWT_SECRET','short'),
                   ('JWT_SECRET','local-development-only-replace-before-deploy'),
                   ('DEV_OTP_EXPOSE','true'), ('ALLOWED_ORIGINS','http://localhost:8443'),
                   ('ALLOWED_ORIGINS',''), ('ALLOWED_ORIGINS','https://localhost/path'),
                   ('ALLOWED_ORIGINS','https://user:pw@localhost'), ('SMS_PROVIDER_URL',''),
                   ('SMS_PROVIDER_URL','http://sms.example.invalid'), ('SMS_PROVIDER_TOKEN',''),
                   ('DATA_DIR','relative'), ('DATABASE_URL','file:./dev.db')]
        for key,value in changes:
            with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                runtime.validate_environment(dict(self.env, **{key:value}))
    def test_data_directory_symlink_rejected(self):
        link = Path(self.temp.name) / 'link'
        link.symlink_to(self.temp.name)
        with self.assertRaises(ValueError): runtime.validate_environment(dict(self.env, DATA_DIR=str(link)))

class DeploymentContractTests(unittest.TestCase):
    def test_no_build_time_migration(self):
        docker = (ROOT / 'Dockerfile').read_text()
        self.assertNotIn('migrate deploy', docker)
        self.assertIn('USER node', docker)
        self.assertIn('runtime.py', docker)
    def test_loopback_only_persistent_storage_and_no_api_port(self):
        compose = (ROOT / 'compose.yaml').read_text()
        self.assertIn('127.0.0.1:8443:8443', compose)
        self.assertIn('data:/data', compose)
        self.assertIn('backups:/backups', compose)
        self.assertNotIn('3000:3000', compose)
        self.assertIn("DEV_OTP_EXPOSE: 'false'", compose)
    def test_same_origin_proxy_never_falls_api_back_to_html(self):
        nginx = (ROOT / 'nginx.conf').read_text()
        self.assertIn('location ^~ /api/', nginx)
        self.assertIn('proxy_pass http://api:3000;', nginx)
        self.assertIn('location = /api { return 404; }', nginx)
        self.assertIn('try_files $uri $uri/ /index.html;', nginx)
        self.assertIn('proxy_buffering off;', nginx)
        self.assertNotIn('proxy_set_header Origin', nginx)
    def test_private_material_excluded_from_build_context(self):
        ignore = (ROOT.parents[1] / '.dockerignore').read_text()
        for entry in ['**/.env', '**/.env.*', '**/*.db', '**/*.sqlite*', '**/*.pem', '**/*.key']:
            self.assertIn(entry, ignore)

class DockerCiContracts(unittest.TestCase):
    def test_fixture_uses_explicit_ca_no_production_calls_or_trust_changes(self):
        script = (ROOT / 'test-docker.sh').read_text()
        self.assertIn('--cacert "$tls/cert.pem"', script)
        self.assertNotIn('--insecure', script)
        self.assertNotIn('curl -k', script)
        self.assertNotIn('update-ca-certificates', script)
        self.assertIn('https://sms.example.invalid/send', script)
        self.assertNotIn('/api/auth/send-code', script)
        self.assertIn('YOU_TRACE_SYNTHETIC_DOCKER_TEST', script)
        self.assertIn('--project-name "$project"', script)
        self.assertIn('Refusing to replace existing local configuration', script)
        self.assertIn('AI_CREDENTIAL_ENCRYPTION_KEY=ERER', script)
        self.assertIn('globalThis.fetch = async', script)
        self.assertIn("error.code === 'AI_CREDENTIALS_UNAVAILABLE'", script)
        self.assertIn('cmp "$temp/ai-before.sha256" "$temp/ai-restored.sha256"', script)
        self.assertNotIn('/api/ai-connection/probe', script)
    def test_manual_workflow_has_no_deploy_or_write_permission(self):
        workflow = (ROOT.parents[1] / '.github/workflows/local-durability.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('push:', workflow)
        self.assertIn('branches: [main]', workflow)
        self.assertIn("'deploy/local/**'", workflow)
        self.assertIn('contents: read', workflow)
        self.assertNotIn('contents: write', workflow)
        self.assertNotIn('pull_request_target', workflow)
        self.assertIn('timeout-minutes: 25', workflow)
        self.assertIn('bash deploy/local/test-docker.sh', workflow)

if __name__ == '__main__': unittest.main()
