"""Isolated real-process refusal coverage. Historical migrations are copied verbatim.
All records/keys are fixed public synthetic fixtures. No provider calls are allowed.
"""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest

from test_runtime_chain import LOCAL, SERVER, RuntimeFixture
import runtime
import storage

MIGRATIONS = SERVER / 'prisma/migrations'
BASELINE = '20260731190000_initial_baseline'
AUTH = '20260731190001_auth_security'
SYNC = '20260823000000_sync_foundation'
SYNC_TABLES = ('Expense', 'QuickNote', 'Habit', 'HabitCheckin', 'Diary', 'HabitLog')
MARKER_TABLE = '__youji_auth_security_marker'


def dump(path):
    with closing(storage.connect_readonly(path)) as db:
        return '\n'.join(db.iterdump())


class NegativeRuntime(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.fixture = RuntimeFixture(self, self.temp.name)
        self.addCleanup(self.fixture.close)
        self.data, self.backups = self.fixture.data, self.fixture.backups
        self.database = self.data / storage.DB_NAME
        self.original_migrations = {
            str(path.relative_to(MIGRATIONS)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in MIGRATIONS.rglob('*') if path.is_file()}
        self.addCleanup(self.assert_migrations_unchanged)

    def assert_migrations_unchanged(self):
        actual = {str(path.relative_to(MIGRATIONS)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in MIGRATIONS.rglob('*') if path.is_file()}
        self.assertEqual(actual, self.original_migrations)

    def legacy_database(self, names=(BASELINE, AUTH)):
        schema_dir = Path(self.temp.name) / 'legacy-prisma'
        schema_dir.mkdir()
        shutil.copyfile(SERVER / 'prisma/schema.prisma', schema_dir / 'schema.prisma')
        (schema_dir / 'migrations').mkdir()
        shutil.copyfile(MIGRATIONS / 'migration_lock.toml', schema_dir / 'migrations/migration_lock.toml')
        for name in names:
            shutil.copytree(MIGRATIONS / name, schema_dir / 'migrations' / name)
        result = self.fixture.run(['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy',
                                   '--schema', str(schema_dir / 'schema.prisma')], timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with closing(storage.connect_readonly(self.database)) as db:
            records = db.execute('SELECT migration_name, checksum, finished_at, rolled_back_at '
                                 'FROM _prisma_migrations ORDER BY migration_name').fetchall()
        self.assertEqual([row[0] for row in records], list(names))
        for name, checksum, finished, rolled_back in records:
            self.assertEqual(checksum, hashlib.sha256((MIGRATIONS / name / 'migration.sql').read_bytes()).hexdigest())
            self.assertIsNotNone(finished)
            self.assertIsNone(rolled_back)
        storage.make_marker(self.data)

    def minimal_database(self, table, history=None, fixture=None):
        fixture = fixture or self.fixture
        with sqlite3.connect(fixture.data / storage.DB_NAME) as db:
            db.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY, value TEXT)')
            db.execute(f'INSERT INTO "{table}" VALUES (1, ?)', ('synthetic-private-source-value',))
            if history is not None:
                db.execute('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT)')
                db.executemany('INSERT INTO _prisma_migrations VALUES (?, ?, ?)', history)
        storage.make_marker(fixture.data)

    def node_tripwire_env(self, fixture=None):
        # A real executable catches any Prisma/server launch in refusal paths.
        fixture = fixture or self.fixture
        directory = fixture.root / 'tripwire-bin'; directory.mkdir(exist_ok=True)
        attempted = fixture.root / 'node-was-started'
        executable = directory / 'node'
        executable.write_text('#!/bin/sh\nprintf started > "' + str(attempted) + '"\nexit 93\n')
        executable.chmod(0o700)
        return dict(fixture.env, PATH=str(directory) + ':' + fixture.env['PATH']), attempted

    def assert_refused_preserving_source(self, expected, fixture=None):
        fixture = fixture or self.fixture
        database = fixture.data / storage.DB_NAME
        before_bytes = database.read_bytes()
        before_dump = dump(database)
        before_marker = (fixture.data / storage.INSTALL).read_bytes()
        config, attempted = self.node_tripwire_env(fixture)
        result = fixture.run([sys.executable, str(LOCAL / 'runtime.py')], config)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Local startup refused: Unsafe pending legacy migration', result.stderr)
        self.assertIn('Verified prestart backup retained in BACKUP_DIR', result.stderr)
        for name in expected:
            self.assertIn(name, result.stderr)
        self.assertIn('restore', result.stderr)
        self.assertIn('new directory', result.stderr)
        self.assertIn('manual review', result.stderr)
        self.assertNotIn('synthetic-private-source-value', result.stderr)
        self.assertFalse(attempted.exists(), 'Guard ran after Prisma/server was already started')
        self.assertEqual(database.read_bytes(), before_bytes)
        self.assertEqual(dump(database), before_dump)
        self.assertEqual((fixture.data / storage.INSTALL).read_bytes(), before_marker)
        snapshots = list(fixture.backups.glob('prestart-*.sqlite3'))
        self.assertEqual(len(snapshots), 1)
        saved = snapshots[0]
        receipt = json.loads(Path(str(saved) + '.json').read_text())
        self.assertEqual(receipt['sha256'], hashlib.sha256(saved.read_bytes()).hexdigest())
        self.assertEqual(dump(saved), before_dump)
        target = fixture.root / 'restored-for-review'
        storage.restore(saved, target)
        storage.require_install(target)
        self.assertEqual(dump(target / storage.DB_NAME), before_dump)
        with closing(storage.connect_readonly(target / storage.DB_NAME)) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchall(), [('ok',)])
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_populated_exact_first_two_migrations_refuse_with_verified_restorable_backup(self):
        self.legacy_database()
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO User (id, phone, nickname, updatedAt) VALUES ('owner', '13800000000', 'Synthetic', '2026-01-01')")
            db.execute("INSERT INTO Expense (id, userId, amount, category, name, date) VALUES ('expense', 'owner', 123, 'other', 'Synthetic', '2026-01-01')")
            db.execute("INSERT INTO QuickNote (id, userId, content, timestamp, parsed) VALUES ('note', 'owner', 'synthetic-private-source-value', 0, '{}')")
            db.execute("INSERT INTO Habit (id, userId, name, icon) VALUES ('habit', 'owner', 'Synthetic', 'star')")
            db.executemany("INSERT INTO HabitCheckin (habitId, date) VALUES ('habit', ?)", [('2026-01-01',), ('2026-01-01',)])
            db.executemany("INSERT INTO Diary (userId, date, content, updatedAt) VALUES ('owner', '2026-01-01', ?, ?)",
                           [('older synthetic diary', '2026-01-01'), ('newer synthetic diary', '2026-01-02')])
            db.execute('CREATE TABLE HabitLog (id TEXT PRIMARY KEY, content TEXT)')
            db.execute("INSERT INTO HabitLog VALUES ('legacy-log', 'synthetic old habit log')")
        self.assert_refused_preserving_source((SYNC,) + SYNC_TABLES)
        with closing(storage.connect_readonly(self.database)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM Diary').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM HabitCheckin').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM _prisma_migrations').fetchone()[0], 2)
            self.assertNotIn('updatedAt', [row[1] for row in db.execute('PRAGMA table_info(Expense)')])

    def test_pending_auth_marker_refuses_before_its_drop(self):
        self.legacy_database((BASELINE,))
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE __youji_auth_security_marker (id INTEGER PRIMARY KEY)')
            db.execute('INSERT INTO __youji_auth_security_marker VALUES (42)')
        self.assert_refused_preserving_source((AUTH, MARKER_TABLE))

    def test_each_sync_risk_table_independently_blocks_whole_startup(self):
        # Independent minimal tables ensure Habit cannot mask HabitCheckin/HabitLog
        # and an ALTER failure cannot mask destructive Diary/marker handling.
        for table in SYNC_TABLES:
            with self.subTest(table=table), tempfile.TemporaryDirectory() as tmp:
                nested = RuntimeFixture(self, tmp)
                try:
                    self.minimal_database(table, fixture=nested)
                    self.assert_refused_preserving_source((SYNC, table), nested)
                finally:
                    nested.close()

    def test_failed_or_rolled_back_history_is_not_completion(self):
        for migration, table in ((AUTH, MARKER_TABLE), (SYNC, 'Diary')):
            for finished, rolled_back in ((None, None), (None, '2026-01-01'), ('2026-01-01', '2026-01-02')):
                with self.subTest(migration=migration, finished=finished, rolled_back=rolled_back), tempfile.TemporaryDirectory() as tmp:
                    nested = RuntimeFixture(self, tmp)
                    try:
                        self.minimal_database(table, [(migration, finished, rolled_back)], nested)
                        self.assert_refused_preserving_source((migration, table), nested)
                    finally:
                        nested.close()

    def test_completed_migrations_allow_populated_tables_and_empty_legacy_is_allowed(self):
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE _prisma_migrations (migration_name TEXT, finished_at TEXT, rolled_back_at TEXT)')
            for table in (MARKER_TABLE,) + SYNC_TABLES:
                db.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY)')
        runtime.require_safe_pending_migrations(self.database)
        with sqlite3.connect(self.database) as db:
            for table in (MARKER_TABLE,) + SYNC_TABLES:
                db.execute(f'INSERT INTO "{table}" VALUES (1)')
            for migration in (AUTH, SYNC):
                # Earlier failed/rolled-back attempts do not erase actual success.
                db.executemany('INSERT INTO _prisma_migrations VALUES (?, ?, ?)',
                               [(migration, None, '2026-01-01'), (migration, '2026-01-02', None)])
        before = self.database.read_bytes()
        runtime.require_safe_pending_migrations(self.database)
        self.assertEqual(self.database.read_bytes(), before)

    def test_original_migration_still_reproduces_nonconstant_default_failure_on_disposable_copy(self):
        self.legacy_database()
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO User (id, phone, nickname, updatedAt) VALUES ('owner', '13800000000', 'Synthetic', '2026-01-01')")
            db.execute("INSERT INTO Expense (id, userId, amount, category, name, date) VALUES ('expense', 'owner', 123, 'other', 'Synthetic', '2026-01-01')")
        before = self.database.read_bytes()
        copy = Path(self.temp.name) / 'disposable-unsafe-probe.sqlite3'
        storage.snapshot(self.database, copy)
        result = self.fixture.run(['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'],
                                  dict(self.fixture.env, DATABASE_URL='file:' + str(copy)), timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('non-constant default', result.stdout + result.stderr)
        self.assertIn(SYNC, result.stdout + result.stderr)
        self.assertEqual(self.database.read_bytes(), before)
        with closing(storage.connect_readonly(copy)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM Expense').fetchone()[0], 1)
            self.assertIsNone(db.execute('SELECT finished_at FROM _prisma_migrations WHERE migration_name=?', (SYNC,)).fetchone()[0])

    def test_empty_exact_first_two_migrations_still_start(self):
        self.legacy_database()
        child = self.fixture.start(dict(self.fixture.env, YOU_TRACE_INITIALIZE_EMPTY='false'))
        with closing(storage.connect_readonly(self.database)) as db:
            names = {row[0] for row in db.execute('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')}
            self.assertEqual(names, {path.name for path in MIGRATIONS.iterdir() if path.is_dir()})
        self.fixture.stop(child)

    def test_corrupt_database_cannot_produce_successful_backup_receipt_or_start_prisma(self):
        self.database.write_bytes(b'not a SQLite database: synthetic corrupt fixture')
        storage.make_marker(self.data)
        before = self.database.read_bytes()
        config, attempted = self.node_tripwire_env()
        result = self.fixture.run([sys.executable, str(LOCAL / 'runtime.py')], config)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(attempted.exists())
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.backups.glob('*.json')), [])

    def test_missing_sms_refuses_before_empty_initialization(self):
        for variable in ('SMS_PROVIDER_URL', 'SMS_PROVIDER_TOKEN'):
            with self.subTest(variable=variable):
                config = dict(self.fixture.env)
                config.pop(variable)
                result = self.fixture.run([sys.executable, str(LOCAL / 'runtime.py')], config)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Production login requires', result.stderr)
                self.assertEqual(list(self.data.iterdir()), [])
                self.assertEqual(list(self.backups.iterdir()), [])

    def test_raw_http_missing_sms_is_503_without_otp_or_persisted_challenge(self):
        # Bypass only the supervisor to verify the API's independent fail-closed
        # layer; production mode remains enabled and no OTP is captured or sent.
        result = self.fixture.run(['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'], timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        config = dict(self.fixture.env)
        config.pop('SMS_PROVIDER_URL'); config.pop('SMS_PROVIDER_TOKEN')
        child = self.fixture.start(config, managed=False)
        status, body, headers = self.fixture.request('/api/auth/send-code', value={'phone':'13800000000'})
        self.assertEqual(status, 503)
        self.assertEqual(set(body), {'error'})
        self.assertNotIn('Set-Cookie', headers)
        with closing(storage.connect_readonly(self.database)) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM AuthChallenge').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM RegistrationTicket').fetchone()[0], 0)
        self.fixture.stop(child)


if __name__ == '__main__':
    unittest.main()
