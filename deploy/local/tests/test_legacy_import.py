"""Rebuilt candidate tests: synthetic exact legacy schemas, real Prisma and HTTP."""
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

LOCAL = Path(__file__).resolve().parents[1]
SERVER = LOCAL.parents[1] / 'youji-app/server'
sys.path.insert(0, str(LOCAL))
import legacy_import as importer
import storage

STAMP = '2026-07-31 12:34:56'
ORIGINAL = '  原文\n不同内容 🧭\u0000  '


class LegacyImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base_tmp = tempfile.TemporaryDirectory()
        cls.templates = Path(cls.base_tmp.name)
        for count in (1, 2):
            directory = cls.templates / str(count); directory.mkdir()
            prisma = directory / 'prisma'; prisma.mkdir()
            (prisma / 'schema.prisma').write_text('datasource db {\n provider = "sqlite"\n url = env("DATABASE_URL")\n}\n')
            (prisma / 'migrations').mkdir()
            shutil.copyfile(importer.MIGRATIONS / 'migration_lock.toml', prisma / 'migrations/migration_lock.toml')
            for name in list(importer.MIGRATION_HASHES)[:count]:
                shutil.copytree(importer.MIGRATIONS / name, prisma / 'migrations' / name)
            result = subprocess.run(['node', str(SERVER / 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', str(prisma / 'schema.prisma')],
                cwd=directory, env={'PATH': os.environ['PATH'], 'HOME': str(directory), 'DATABASE_URL': 'file:' + str(directory / 'source.sqlite3'),
                                   'CHECKPOINT_DISABLE': '1', 'PRISMA_HIDE_UPDATE_MESSAGE': '1'}, capture_output=True, text=True, timeout=30)
            if result.returncode: raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls): cls.base_tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.source = self.root / 'source.sqlite3'; self.output = self.root / 'new-import'
        shutil.copyfile(self.templates / '2/source.sqlite3', self.source)
        self.populate()

    def tearDown(self): self.tmp.cleanup()

    def populate(self):
        with sqlite3.connect(self.source) as db:
            for suffix, phone in [('a', '13800000001'), ('b', '13800000002')]:
                owner = 'owner-' + suffix + '-001'
                db.execute('INSERT INTO User(id,phone,nickname,coachStyle,pushLimit,quietStart,quietEnd,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)',
                    (owner, phone, 'Synthetic ' + suffix, 'strict', 4, '22:10', '06:20', STAMP, 1785492000000))
                db.execute('INSERT INTO Schedule(id,userId,title,date,startTime,endTime,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)',
                    ('schedule-' + suffix, owner, ORIGINAL, '2026-07-31', '09:00', '10:00', STAMP, STAMP))
                db.execute('INSERT INTO Expense(id,userId,amount,category,name,date,createdAt) VALUES(?,?,?,?,?,?,?)',
                    ('expense-' + suffix, owner, 123456789, 'other', ORIGINAL, '2026-07-31', STAMP))
                db.execute('INSERT INTO Todo(id,userId,text,done,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
                    ('todo-000-' + suffix, owner, ORIGINAL, 1, STAMP, STAMP))
                db.execute('INSERT INTO Habit(id,userId,name,icon,createdAt) VALUES(?,?,?,?,?)', ('habit-00-' + suffix, owner, ORIGINAL, 'H', STAMP))
                parsed = ' { "expenses": [], "diary": "  原文  ", "mood": null, "moodScore": 5, "habits": [], "todos": ["保留待办"] } '
                db.execute('INSERT INTO QuickNote(id,userId,content,timestamp,parsed,createdAt) VALUES(?,?,?,?,?,?)',
                    ('quicknote-' + suffix, owner, ORIGINAL, 1785492000001, parsed, STAMP))
                db.execute('INSERT INTO Diary(userId,date,content,createdAt,updatedAt) VALUES(?,?,?,?,?)', (owner, '2026-07-31', ORIGINAL + suffix, STAMP, STAMP))
                db.execute('INSERT INTO ChatSession(id,userId,createdAt) VALUES(?,?,?)', ('chat-000-' + suffix, owner, STAMP))
                db.execute('INSERT INTO ChatMessage(id,sessionId,role,content,actions,createdAt) VALUES(?,?,?,?,?,?)',
                    ('message-' + suffix, 'chat-000-' + suffix, 'user', ORIGINAL, ' [] ', STAMP))
                db.execute('INSERT INTO Insight(id,userId,type,title,description,dataSources,createdAt) VALUES(?,?,?,?,?,?,?)',
                    ('insight-' + suffix, owner, 'pattern', ORIGINAL, ORIGINAL, ' ["expense", "habit"] ', STAMP))
                db.execute('INSERT INTO Push(id,userId,insightId,type,title,body,createdAt) VALUES(?,?,?,?,?,?,?)',
                    ('push-000-' + suffix, owner, 'insight-' + suffix, 'insight', ORIGINAL, ORIGINAL, STAMP))
            db.execute('INSERT INTO AuthChallenge(id,phone,purpose,codeHash,expiresAt) VALUES(?,?,?,?,?)',
                ('synthetic-challenge', '13800000001', 'login', 'synthetic-hash-no-secret', '2099-01-01 00:00:00'))
            db.execute('INSERT INTO RegistrationTicket(id,phone,tokenHash,expiresAt) VALUES(?,?,?,?)',
                ('synthetic-ticket', '13800000003', 'synthetic-ticket-hash', '2099-01-01 00:00:00'))

    def seal(self):
        storage.write_new_json(Path(str(self.source) + '.json'), {'format': 1, 'sha256': importer.digest_file(self.source), 'created_at': 'synthetic'})
        self.original_hash = importer.digest_file(self.source)
        self.original_receipt_hash = importer.digest_file(str(self.source) + '.json')

    def cli(self, output=None):
        return subprocess.run([sys.executable, str(LOCAL / 'legacy_import.py'), '--source', str(self.source), '--new-output-dir', str(output or self.output)],
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'), capture_output=True, text=True, timeout=60)

    def unchanged(self):
        self.assertEqual(importer.digest_file(self.source), self.original_hash)
        self.assertEqual(importer.digest_file(str(self.source) + '.json'), self.original_receipt_hash)
        self.assertFalse(any(Path(str(self.source) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')))

    def blocked(self, *codes):
        self.seal(); self.assertEqual(importer.run(self.source, self.output), 2)
        plan = json.loads((self.output / 'plan.json').read_text())
        self.assertTrue(set(codes) <= {item['code'] for item in plan['conflicts']}, plan['conflicts'])
        self.assertFalse((self.output / 'data').exists()); self.assertFalse((self.output / 'candidate.json').exists())
        self.assertEqual(importer.digest_file(self.output / 'source.sqlite3'), self.original_hash)
        self.unchanged(); return plan

    def variant(self, name, sql, args=()):
        source = self.root / (name + '.sqlite3'); shutil.copyfile(self.source, source)
        with sqlite3.connect(source) as db: db.execute(sql, args)
        return source, self.root / (name + '-output')

    def test_supported_histories_preserve_all_unambiguous_tables_and_restore(self):
        for count in (1, 2):
            with self.subTest(history=count):
                source = self.root / ('history-' + str(count) + '.sqlite3')
                shutil.copyfile(self.templates / str(count) / 'source.sqlite3', source)
                self.source = source; self.populate(); self.seal()
                output = self.root / ('history-output-' + str(count))
                result = self.cli(output); self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn(ORIGINAL, result.stdout + result.stderr); self.assertNotIn('synthetic-ticket-hash', result.stdout + result.stderr)
                self.assertFalse((output / 'data' / storage.INSTALL).exists())
                self.assertFalse(json.loads((output / 'candidate.json').read_text())['installation_enrolled'])
                target = output / 'data' / storage.DB_NAME; storage.check_database(target)
                with closing(storage.connect_readonly(source)) as old, closing(storage.connect_readonly(target)) as new:
                    for table in importer.TABLES:
                        if table in importer.AUTH_TABLES:
                            self.assertEqual(new.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0); continue
                        columns = [row[1] for row in old.execute('PRAGMA table_info(' + table + ')')]
                        originals = old.execute('SELECT * FROM ' + table + ' ORDER BY id').fetchall()
                        if table == 'Diary': originals = [('legacy-diary-' + str(row[0]), *row[1:]) for row in originals]
                        migrated = new.execute('SELECT ' + ','.join(map(importer.quote, columns)) + ' FROM ' + table + ' ORDER BY id').fetchall()
                        self.assertEqual(migrated, originals, table)
                    self.assertEqual(new.execute('SELECT completedAt FROM Todo').fetchall(), [(None,), (None,)])
                    for table in ('Expense', 'Habit', 'QuickNote'):
                        self.assertEqual(new.execute('SELECT COUNT(*) FROM ' + table + ' WHERE createdAt=updatedAt').fetchone()[0], 2)
                    self.assertEqual(new.execute('SELECT coachStyle,pushLimit,quietStart,quietEnd,revision,coachPushEnabled,quietEnabled,eveningReviewEnabled,eveningReviewTime FROM AccountPreferences').fetchall(),
                        [('strict', 4, '22:10', '06:20', 0, 0, 1, 0, '21:00')] * 2)
                    self.assertEqual(new.execute('SELECT COUNT(*) FROM SyncChange').fetchone()[0], 12)
                    for table in ('SyncTombstone', 'SyncReceipt', 'AccountPreferenceReceipt', 'RevokedSession', 'UserAIConnection'):
                        self.assertEqual(new.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0], 0)
                    self.assertEqual(dict(new.execute('SELECT migration_name,checksum FROM _prisma_migrations')), importer.MIGRATION_HASHES)
                restored = self.root / ('restore-' + str(count)); storage.restore(output / 'imported.sqlite3', restored)
                self.assertEqual(importer.digest_file(restored / storage.DB_NAME), importer.digest_file(output / 'imported.sqlite3'))
                raw = json.loads((output / 'source-export.json').read_text())['tables']
                self.assertEqual(len(raw['AuthChallenge']['rows']), 1); self.assertEqual(len(raw['RegistrationTicket']['rows']), 1)
                for path in output.rglob('*'):
                    if path.is_file(): self.assertEqual(path.stat().st_mode & 0o077, 0, str(path))
                self.unchanged()

    def test_current_nonempty_database_additive_push_migration_uses_real_prisma(self):
        directory = self.root / 'current-upgrade'; directory.mkdir()
        prisma = directory / 'prisma'; prisma.mkdir(); (prisma / 'migrations').mkdir()
        (prisma / 'schema.prisma').write_text('datasource db {\n provider = "sqlite"\n url = env("DATABASE_URL")\n}\n')
        shutil.copyfile(importer.MIGRATIONS / 'migration_lock.toml', prisma / 'migrations/migration_lock.toml')
        names = list(importer.MIGRATION_HASHES)
        for name in names[:-1]: shutil.copytree(importer.MIGRATIONS / name, prisma / 'migrations' / name)
        target = directory / 'existing.sqlite3'
        def migrate():
            result = subprocess.run(['node', str(SERVER / 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', str(prisma / 'schema.prisma')],
                cwd=directory, env={'PATH': os.environ['PATH'], 'HOME': str(directory), 'DATABASE_URL': 'file:' + str(target),
                    'CHECKPOINT_DISABLE': '1', 'PRISMA_HIDE_UPDATE_MESSAGE': '1'}, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        migrate()
        with sqlite3.connect(target) as db:
            db.execute('INSERT INTO User(id,phone,nickname,createdAt,updatedAt) VALUES(?,?,?,?,?)', ('upgrade-owner', 'synthetic-upgrade', ORIGINAL, STAMP, STAMP))
            db.execute('INSERT INTO Push(id,userId,type,title,body,actions,createdAt) VALUES(?,?,?,?,?,?,?)', ('upgrade-push', 'upgrade-owner', 'follow_up', ORIGINAL, ORIGINAL, ' [] ', STAMP))
            originals = db.execute('SELECT * FROM Push').fetchall()
            old_history = db.execute('SELECT * FROM _prisma_migrations ORDER BY migration_name').fetchall()
        shutil.copytree(importer.MIGRATIONS / names[-1], prisma / 'migrations' / names[-1]); migrate(); migrate()
        with sqlite3.connect(target) as db:
            self.assertEqual(db.execute('SELECT * FROM Push').fetchall(), originals)
            self.assertEqual(db.execute('SELECT * FROM _prisma_migrations ORDER BY migration_name').fetchall()[:-1], old_history)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM SyncTombstone').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('sync_Push_delete','sync_Push_no_resurrection','sync_Push_identity_immutable')").fetchone()[0], 3)
            db.execute("DELETE FROM Push WHERE id='upgrade-push'")
            self.assertEqual(db.execute("SELECT userId,entity,entityId FROM SyncTombstone").fetchall(), [('upgrade-owner', 'coachPushes', 'upgrade-push')])
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO Push(id,userId,type,title,body) VALUES(?,?,?,?,?)', ('upgrade-push', 'upgrade-owner', 'follow_up', 'new', 'new'))

    def test_duplicate_diaries_include_identical_and_invalid_members_without_winner(self):
        with sqlite3.connect(self.source) as db:
            db.executemany('INSERT INTO Diary(userId,date,content,createdAt,updatedAt) VALUES(?,?,?,?,?)',
                [('owner-a-001', '2026-07-31', ORIGINAL + 'a', STAMP, STAMP),
                 ('owner-a-001', '2026-07-31', 'distinct original', STAMP, 'bad-time')])
        plan = self.blocked('DUPLICATE_BUSINESS_KEY_ALL_MEMBERS_BLOCKED', 'UNSUPPORTED_FIELD_VALUE')
        group = next(item for item in plan['conflicts'] if item['code'].startswith('DUPLICATE'))
        self.assertEqual(len(group['source_ids']), 3)
        self.assertEqual(len([item for item in plan['mappings'] if item['table'] == 'Diary' and item['owner_id'] == 'owner-a-001' and item['disposition'] == 'blocked_conflict']), 3)
        raw = json.loads((self.output / 'source-export.json').read_text())['tables']['Diary']
        self.assertIn('distinct original', [row[raw['columns'].index('content')]['value'] for row in raw['rows']])

    def test_checkin_missing_time_and_duplicates_preserve_both_id_kinds(self):
        with sqlite3.connect(self.source) as db:
            db.executemany('INSERT INTO HabitCheckin(habitId,date,done,aiReason) VALUES(?,?,?,?)',
                [('habit-00-a', '2026-07-31', 0, 'first'), ('habit-00-a', '2026-07-31', 1, 'different'), ('habit-00-b', '2026-07-31', 1, 'single')])
        plan = self.blocked('MISSING_HISTORICAL_CREATED_AT', 'DUPLICATE_BUSINESS_KEY_ALL_MEMBERS_BLOCKED')
        rows = [row for row in plan['mappings'] if row['table'] == 'HabitCheckin']; self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0]['target_id'], 'legacy-checkin-1'); self.assertEqual(rows[0]['sync_entity_id'], 'habit-00-a|2026-07-31')
        self.assertEqual(rows[2]['owner_id'], 'owner-b-001'); self.assertTrue(all(row['disposition'] == 'blocked_conflict' for row in rows))

    def test_orphan_and_cross_owner_soft_reference_not_claimed(self):
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE ChatMessage SET sessionId='missing-session' WHERE id='message-a'")
            db.execute("UPDATE Push SET insightId='insight-b' WHERE id='push-000-a'")
        plan = self.blocked('OWNER_OR_PARENT_MISSING', 'UNVERIFIED_OWNER', 'CROSS_OWNER_OR_MISSING_INSIGHT')
        row = next(row for row in plan['mappings'] if row['table'] == 'ChatMessage' and row['source_id']['value'] == 'message-a')
        self.assertIsNone(row['owner_id'])

    def test_schema_and_history_variants_refuse_with_raw_archive(self):
        changes = ["ALTER TABLE Habit ADD COLUMN unexpected TEXT", 'CREATE TABLE HabitLog(original TEXT)',
            "UPDATE _prisma_migrations SET finished_at=NULL WHERE migration_name LIKE '%auth_security'",
            "UPDATE _prisma_migrations SET checksum='wrong' WHERE migration_name LIKE '%auth_security'",
            "UPDATE _prisma_migrations SET rolled_back_at='2026-01-01' WHERE migration_name LIKE '%auth_security'",
            'DELETE FROM _prisma_migrations', "UPDATE _prisma_migrations SET finished_at='bad-time'"]
        original = self.source
        for index, sql in enumerate(changes):
            with self.subTest(change=index):
                self.source = original; self.source, self.output = self.variant('drift-' + str(index), sql)
                self.blocked('UNSUPPORTED_SOURCE_SCHEMA' if index < 2 else 'UNSUPPORTED_MIGRATION_HISTORY')

    def test_sqlite_lookalike_user_table_is_unknown_schema_not_silently_ignored(self):
        with sqlite3.connect(self.source) as db:
            db.execute('CREATE TABLE sqliteX_private_records(original TEXT)')
            db.execute('INSERT INTO sqliteX_private_records VALUES(?)', (ORIGINAL,))
        self.blocked('UNSUPPORTED_SOURCE_SCHEMA')
        raw = json.loads((self.output / 'source-export.json').read_text())['tables']['sqliteX_private_records']
        self.assertEqual(raw['rows'], [[{'type': 'text', 'value': ORIGINAL}]])
        self.assertFalse((self.output / 'candidate.json').exists())
        self.assertFalse((self.output / 'data').exists())

    def test_sqlite_lookalike_history_index_is_not_silently_ignored(self):
        with sqlite3.connect(self.source) as db:
            db.execute('CREATE INDEX sqliteX_private_history ON _prisma_migrations(migration_name)')
        self.blocked('UNSUPPORTED_MIGRATION_HISTORY_SCHEMA')

    def test_noncanonical_prisma_history_metadata_refused(self):
        with sqlite3.connect(self.source) as db:
            rows = db.execute('SELECT migration_name,checksum FROM _prisma_migrations').fetchall()
            db.executescript('DROP TABLE _prisma_migrations; CREATE TABLE _prisma_migrations(migration_name TEXT,checksum TEXT,finished_at TEXT,applied_steps_count INTEGER);')
            db.executemany('INSERT INTO _prisma_migrations VALUES(?,?,?,?)', [(*row, STAMP, 1) for row in rows])
        self.blocked('UNSUPPORTED_MIGRATION_HISTORY_SCHEMA')

    def test_integer_id_and_unsafe_bigint_are_archived_exactly(self):
        with sqlite3.connect(self.source) as db:
            db.execute('UPDATE Diary SET id=? WHERE id=1', (9223372036854775806,))
            db.execute('UPDATE QuickNote SET timestamp=? WHERE id=?', (9007199254740993, 'quicknote-a'))
        plan = self.blocked('UNSAFE_CLIENT_INTEGER')
        row = next(row for row in plan['mappings'] if row['table'] == 'Diary' and row['owner_id'] == 'owner-a-001')
        self.assertEqual(row['source_id'], {'type': 'integer', 'value': '9223372036854775806'})
        self.assertEqual(row['target_id'], 'legacy-diary-9223372036854775806')
        raw = json.loads((self.output / 'source-export.json').read_text())['tables']['QuickNote']
        self.assertIn({'type': 'integer', 'value': '9007199254740993'}, [row[raw['columns'].index('timestamp')] for row in raw['rows']])

    def test_all_unsafe_prisma_integer_domains_block_before_js_rounding(self):
        original = self.source
        for index, (table, column, value) in enumerate([('Habit', 'sortOrder', 9007199254740993), ('Schedule', 'remind', 9007199254740993),
                ('Diary', 'moodScore', 9007199254740993), ('Expense', 'amount', 2147483648)]):
            with self.subTest(table=table):
                self.source = original; self.source, self.output = self.variant('integer-' + str(index), 'UPDATE ' + table + ' SET ' + column + '=?', (value,))
                self.blocked('UNSAFE_PRISMA_INTEGER')

    def test_invalid_time_offsets_and_precision_never_fallback_to_now(self):
        original = self.source
        for index, value in enumerate(['2026-07-31T12:00:00', '2026-07-31T12:00:00+01:60', '2026-07-31T12:00:00-00:99', '2026-07-31T12:00:00.1234Z']):
            with self.subTest(value=value):
                self.source = original; self.source, self.output = self.variant('time-' + str(index), 'UPDATE Diary SET updatedAt=?', (value,))
                self.blocked('UNSUPPORTED_FIELD_VALUE')

    def test_invalid_preferences_boolean_and_schedule_not_replaced_with_defaults(self):
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE User SET quietStart='invalid'")
            db.execute("UPDATE Todo SET done=2")
            db.execute("UPDATE Schedule SET startTime='27:00',repeat='unreviewed'")
        self.blocked('INVALID_ACCOUNT_PREFERENCES', 'UNSUPPORTED_FIELD_VALUE', 'INVALID_SCHEDULE_TIMES', 'UNSUPPORTED_DOMAIN_VALUE')

    def test_invalid_utf8_and_blob_id_are_losslessly_preserved(self):
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE Diary SET content=CAST(x'80ff00' AS TEXT) WHERE id=1")
            db.execute('UPDATE User SET id=? WHERE id=?', (b'blob-identity', 'owner-b-001'))
        plan = self.blocked('UNSUPPORTED_FIELD_VALUE', 'OWNER_OR_PARENT_MISSING')
        raw = json.loads((self.output / 'source-export.json').read_text())['tables']['Diary']
        self.assertIn({'type': 'text-invalid-utf8', 'value': 'gP8A'}, [row[raw['columns'].index('content')] for row in raw['rows']])
        mapped = next(row for row in plan['mappings'] if row['table'] == 'User' and row['source_id']['type'] == 'blob')
        self.assertIsNone(mapped['owner_id']); self.assertIsNone(mapped['target_id'])

    def test_ambiguous_json_actions_duplicate_keys_do_not_become_live(self):
        with sqlite3.connect(self.source) as db:
            db.execute('UPDATE QuickNote SET parsed=? WHERE id=?', ('{"todos":[],"todos":[{"id":1}]}', 'quicknote-a'))
            db.execute('UPDATE ChatMessage SET actions=? WHERE id=?', ('[{"type":"delete","id":1}]', 'message-a'))
            db.execute('UPDATE Push SET actions=? WHERE id=?', ('{"diaryId":1}', 'push-000-a'))
        plan = self.blocked('JSON_OR_REFERENCE_REVIEW_REQUIRED')
        self.assertEqual(len([row for row in plan['conflicts'] if row['code'] == 'JSON_OR_REFERENCE_REVIEW_REQUIRED']), 3)

    def test_existing_directory_sidecar_symlink_and_bad_receipt_refuse(self):
        self.seal(); self.output.mkdir(); (self.output / 'keep').write_text('unchanged')
        self.assertNotEqual(self.cli().returncode, 0); self.assertEqual((self.output / 'keep').read_text(), 'unchanged')
        sidecar = Path(str(self.source) + '-wal'); sidecar.write_bytes(b'synthetic-active')
        with self.assertRaisesRegex(importer.ImportRefused, 'SIDECARS'): importer.run(self.source, self.root / 'other')
        sidecar.unlink()  # Only this test's synthetic fixture.
        link = self.root / 'linked.sqlite3'; link.symlink_to(self.source)
        with self.assertRaisesRegex(importer.ImportRefused, 'SYMLINK'): importer.run(link, self.root / 'other')
        receipt = Path(str(self.source) + '.json'); data = json.loads(receipt.read_text()); data['sha256'] = '0' * 64; receipt.write_text(json.dumps(data))
        with self.assertRaisesRegex(importer.ImportRefused, 'RECEIPT'): importer.run(self.source, self.root / 'other')
        self.assertEqual(importer.digest_file(self.source), self.original_hash)

    def test_sql_interrupt_and_foreign_key_failure_rollback_without_marker(self):
        self.seal(); original = importer.insert_rows
        for name in ('interrupt', 'foreign-key'):
            with self.subTest(fault=name):
                output = self.root / name
                def failing(db, table, rows):
                    original(db, table, rows)
                    if table == 'Expense':
                        if name == 'interrupt': raise importer.ImportRefused('SYNTHETIC_INTERRUPT')
                        db.execute("UPDATE Expense SET userId='nonexistent-owner'")
                with patch.object(importer, 'insert_rows', side_effect=failing):
                    with self.assertRaises((importer.ImportRefused, sqlite3.IntegrityError)): importer.run(self.source, output)
                self.assertFalse((output / 'data' / storage.INSTALL).exists()); self.assertFalse((output / 'candidate.json').exists())
                with closing(storage.connect_readonly(output / 'data' / storage.DB_NAME)) as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM User').fetchone()[0], 0)
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM SyncChange').fetchone()[0], 0)
                self.unchanged()

    def test_generated_datasource_ignores_shell_targets_and_repository_schema(self):
        self.seal(); sentinel = self.root / 'do-not-migrate.sqlite3'; sentinel.write_bytes(b'unchanged-sentinel')
        with patch.dict(os.environ, {'DATABASE_URL': 'file:' + str(sentinel), 'NODE_OPTIONS': '--require=forbidden.js'}), \
             patch.object(importer.shutil, 'copyfile', side_effect=AssertionError('Must not copy datasource')):
            self.assertEqual(importer.run(self.source, self.output), 0)
        self.assertEqual(sentinel.read_bytes(), b'unchanged-sentinel')
        self.assertEqual((self.output / 'prisma/schema.prisma').read_text(), 'datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}\n')
        self.assertFalse((self.output / 'data' / storage.INSTALL).exists()); self.unchanged()

    def test_post_receipt_fsync_fault_never_enrols_candidate(self):
        self.seal(); original = importer.write_new_json
        def failing(path, value):
            original(path, value)
            if Path(path).name == 'candidate.json': raise OSError('Synthetic fsync failure')
        with patch.object(importer, 'write_new_json', side_effect=failing):
            with self.assertRaises(OSError): importer.run(self.source, self.output)
        self.assertFalse((self.output / 'data' / storage.INSTALL).exists())
        self.assertTrue((self.output / 'failure.json').exists())
        self.assertFalse(json.loads((self.output / 'candidate.json').read_text())['installation_enrolled']); self.unchanged()

    def test_backup_disk_fault_and_corrupt_source_preserve_evidence(self):
        self.seal()
        with patch.object(importer, 'snapshot', side_effect=OSError('Synthetic full disk')):
            with self.assertRaises(OSError): importer.run(self.source, self.output)
        self.assertFalse((self.output / 'data' / storage.INSTALL).exists()); self.assertFalse((self.output / 'candidate.json').exists()); self.unchanged()
        self.source = self.root / 'corrupt.sqlite3'; self.source.write_bytes(b'preserve original corrupt bytes'); self.seal()
        self.output = self.root / 'corrupt-output'; self.assertEqual(self.cli().returncode, 1)
        self.assertEqual((self.output / 'source.sqlite3').read_bytes(), self.source.read_bytes())
        self.assertFalse((self.output / 'data').exists()); self.unchanged()

    def test_deterministic_import_real_http_pagination_and_restart(self):
        with sqlite3.connect(self.source) as db:
            db.executemany('INSERT INTO Todo(id,userId,text,createdAt,updatedAt) VALUES(?,?,?,?,?)',
                [(f'paged-todo-{index:04}', 'owner-a-001', f'Original {index}', STAMP, STAMP) for index in range(2001)])
        self.seal(); self.assertEqual(importer.run(self.source, self.output), 0)
        repeat = self.root / 'repeat'; self.assertEqual(importer.run(self.source, repeat), 0)
        self.assertEqual(json.loads((self.output / 'plan.json').read_text())['mappings'], json.loads((repeat / 'plan.json').read_text())['mappings'])
        data = self.output / 'data'; backups = self.root / 'backups'; backups.mkdir()
        with socket.socket() as sock: sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        attempts = self.root / 'provider-attempts'; guard = self.root / 'deny-fetch.mjs'
        guard.write_text("import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync(" + json.dumps(str(attempts)) + ",'attempt');throw Error('No providers');};")
        env = {'PATH': os.environ['PATH'], 'HOME': str(self.root), 'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': str(port),
            'JWT_SECRET': 'synthetic-import-only-never-deploy-1234567890', 'ALLOWED_ORIGINS': 'https://localhost:8443',
            'SMS_PROVIDER_URL': 'https://sms.example.invalid', 'SMS_PROVIDER_TOKEN': 'synthetic-never-call',
            'DATA_DIR': str(data), 'BACKUP_DIR': str(backups), 'DATABASE_URL': 'file:' + str(data / storage.DB_NAME),
            'DEV_OTP_EXPOSE': 'false', 'SERVER_AI_ENABLED': 'false', 'NODE_OPTIONS': '--import=' + guard.as_uri(), 'PYTHONDONTWRITEBYTECODE': '1'}
        sign = "const jwt=require('jsonwebtoken');process.stdout.write(jwt.sign({id:process.argv[1],phone:process.argv[2]},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'youji-server',audience:'youji-web',subject:process.argv[1],jwtid:'synthetic-import-session',expiresIn:'1h'}));"
        tokens = {owner: subprocess.check_output(['node', '-e', sign, owner, phone], cwd=SERVER, env=env, text=True)
            for owner, phone in [('owner-a-001', '13800000001'), ('owner-b-001', '13800000002')]}
        refused = subprocess.run([sys.executable, str(LOCAL / 'runtime.py')], cwd=SERVER, env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(refused.returncode, 0); self.assertIn('No enrolled installation', refused.stderr)
        def request(owner, path, body=None):
            req = Request(f'http://127.0.0.1:{port}' + path, data=None if body is None else json.dumps(body).encode(),
                headers={'Origin': 'https://localhost:8443', 'Content-Type': 'application/json', 'Cookie': 'youji_session=' + tokens[owner], 'X-YouTrace-Account': owner})
            try:
                with urlopen(req, timeout=10) as response: return response.status, json.load(response)
            except HTTPError as error:
                with error: return error.code, json.load(error)
        with (self.root / 'api.log').open('w') as log:
            # Raw Node startup exists only in synthetic tests, never in the import tool.
            for cycle in range(2):
                child = subprocess.Popen(['node', 'dist/index.js'], cwd=SERVER, env=env, stdout=log, stderr=log)
                try:
                    for _ in range(200):
                        if child.poll() is not None: self.fail('Synthetic API exited')
                        try:
                            with urlopen(f'http://127.0.0.1:{port}/health', timeout=1) as response:
                                if response.status == 200: break
                        except (URLError, TimeoutError): pass
                        time.sleep(.05)
                    else: self.fail('Synthetic API health timeout')
                    reads = []
                    for owner, expected in [('owner-a-001', 2007 + cycle), ('owner-b-001', 6), ('owner-a-001', 2007 + cycle)]:
                        cursor, events, pages = '0', [], 0
                        while True:
                            code, page = request(owner, '/api/sync/pull?protocol=2&features=goals-v1&cursor=' + cursor + '&limit=2000')
                            self.assertEqual(code, 200, page); events.extend(page['events']); pages += 1; cursor = page['nextCursor']
                            if not page['hasMore']: break
                        self.assertEqual(len(events), expected); self.assertEqual(len({event['seq'] for event in events}), expected)
                        self.assertTrue(all(event['data']['userId'] == owner for event in events)); self.assertEqual(pages, 2 if expected > 2000 else 1); reads.append(events)
                    self.assertEqual(reads[0], reads[2])
                    diary = next(item for item in reads[0] if item['entity'] == 'diaries')
                    self.assertEqual(diary['data']['content'], ORIGINAL + 'a'); self.assertEqual(diary['entityId'], 'legacy-diary-1')
                    for path in ('/api/user/settings', '/api/diary', '/api/quicknote'): self.assertEqual(request('owner-a-001', path)[0], 200)
                    if cycle == 0:
                        mutation = {'protocol': 2, 'mutationId': 'import-stale-version', 'todos': [{'id': 'todo-000-a', 'text': 'valid edit', 'done': False, 'baseVersion': '0'}]}
                        self.assertEqual(request('owner-a-001', '/api/sync/push', mutation)[0], 409)
                        mutation['mutationId'] = 'import-valid-edit'; mutation['todos'][0]['baseVersion'] = next(item['seq'] for item in reads[0] if item['entityId'] == 'todo-000-a')
                        first = request('owner-a-001', '/api/sync/push', mutation); self.assertEqual(first[0], 200, first)
                        self.assertEqual(request('owner-a-001', '/api/sync/push', mutation), first)
                    else:
                        # Additional handoff acceptance: imported data + post-import writes survive a real process restart.
                        self.assertEqual(request('owner-a-001', '/api/sync/push', mutation), first)
                    self.assertFalse(attempts.exists())
                finally:
                    child.terminate()
                    try: child.wait(timeout=10)
                    except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=5)
        self.unchanged()


if __name__ == '__main__': unittest.main()
