"""Import an exact sealed July-2026 SQLite baseline into a NEW offline candidate.

The source and receipt are read-only. Conflicts block the entire import. Even a
verified candidate is never enrolled: session/client cutover is a separate gate.
"""
import argparse
import base64
from collections import defaultdict
from contextlib import closing
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys

from storage import DB_NAME, check_database, snapshot, sync_directory, write_new_json

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / 'youji-app/server'
MIGRATIONS = SERVER / 'prisma/migrations'
MIGRATION_HASHES = {
    '20260731190000_initial_baseline': '87eb5d857ac8bb9a3def03905034e4fd9e718ef5499407573aedfb7606372fd2',
    '20260731190001_auth_security': 'bda65d68dbbbf538adea3b088a6d3160597e81506a2e277d7b21d72673a9d6f0',
    '20260823000000_sync_foundation': '6fa8bfec3e41c3edfdc4b3bcb10b5b410a026a107eb489abfdf98547db2c2d03',
    '20261004000000_sync_v2_ledger': '1a231c69ab60d0d262df213d9d17ef651c51a838d5c90de186e72dd7cd29fbbc',
    '20261004000001_revoked_sessions': '6934448ac658ff754d754fda557afe30184caa17ad59fb028558181caa14d37b',
    '20261004000002_goal_lifecycle': '6c943fa11c6ede9a06c53a23a727da0b9df3b1524a69616bfdd7c14c9abda000',
    '20261004000003_account_preferences': '2897cbc655e637c8ba9db45c1dc5e2cd953eb33f544e0cd780506a1cc4f323aa',
    '20261004000004_todo_completion_time': 'b894f1384f5107d0cae887037ce7adc7cdb5632ebe073f0484b975d6a6dd3a9e',
    '20261005000000_schedule_exceptions': '6cb1183ddebd36e2cd0dda340e03c3bf632063f926467a618776f0eb8c579dce',
    '20261010040000_user_owned_ai': '61c41bb0262218240a0b7ebaf2e481dd0a7c054fd9515a4c189d420a46c13ef7',
}
AUTH_TABLES = ('AuthChallenge', 'RegistrationTicket')
TABLES = ('User', 'Schedule', 'Expense', 'Todo', 'Habit', 'HabitCheckin', 'QuickNote',
          'Diary', 'ChatSession', 'ChatMessage', 'Insight', 'Push', *AUTH_TABLES)
SYNC_TABLES = {'Schedule': 'schedules', 'Expense': 'expenses', 'Todo': 'todos', 'Habit': 'habits',
               'HabitCheckin': 'habitCheckins', 'QuickNote': 'quickNotes', 'Diary': 'diaries'}
HISTORY_COLUMNS = [('id', 'TEXT', 1, None, 1), ('checksum', 'TEXT', 1, None, 0),
    ('finished_at', 'DATETIME', 0, None, 0), ('migration_name', 'TEXT', 1, None, 0),
    ('logs', 'TEXT', 0, None, 0), ('rolled_back_at', 'DATETIME', 0, None, 0),
    ('started_at', 'DATETIME', 1, 'current_timestamp', 0), ('applied_steps_count', 'INTEGER UNSIGNED', 1, '0', 0)]


class ImportRefused(ValueError):
    """Only fixed diagnostic codes, never source values."""


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def digest_file(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def real_path(path, *, directory=False):
    path = Path(path)
    if not path.is_absolute() or any(part.is_symlink() for part in (path, *path.parents)):
        raise ImportRefused('ABSOLUTE_NON_SYMLINK_PATH_REQUIRED')
    if not (path.is_dir() if directory else path.is_file()):
        raise ImportRefused('EXISTING_DIRECTORY_REQUIRED' if directory else 'REGULAR_FILE_REQUIRED')
    return path


def sealed_connection(path):
    db = sqlite3.connect(Path(path).as_uri() + '?mode=ro&immutable=1', uri=True)
    def lossless_text(value):
        try: return value.decode('utf-8')
        except UnicodeDecodeError: return value
    db.text_factory = lossless_text
    return db


def require_sealed(path):
    path = real_path(path)
    if any(os.path.lexists(str(path) + suffix) for suffix in ('-wal', '-shm', '-journal')):
        raise ImportRefused('SEALED_BACKUP_REQUIRED_NO_SIDECARS')
    receipt = json.loads(real_path(str(path) + '.json').read_text())
    if (not isinstance(receipt, dict) or type(receipt.get('format')) is not int or receipt['format'] != 1 or
            not isinstance(receipt.get('sha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', receipt['sha256']) or
            receipt['sha256'] != digest_file(path)):
        raise ImportRefused('SOURCE_RECEIPT_MISMATCH')
    return path, receipt


def typed(value, sqlite_type=None):
    if value is None: return {'type': 'null', 'value': None}
    if isinstance(value, int): return {'type': 'integer', 'value': str(value)}
    if isinstance(value, float): return {'type': 'real', 'value': value.hex()}
    if isinstance(value, bytes):
        return {'type': 'text-invalid-utf8' if sqlite_type == 'text' else 'blob',
                'value': base64.b64encode(value).decode('ascii')}
    return {'type': 'text', 'value': value}


def schema_objects(db):
    return db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
                      "WHERE name NOT GLOB 'sqlite_*' AND tbl_name != '_prisma_migrations' ORDER BY type,name").fetchall()


def migration_sql():
    if sorted(path.parent.name for path in MIGRATIONS.glob('*/migration.sql')) != list(MIGRATION_HASHES):
        raise ImportRefused('UNREVIEWED_TARGET_MIGRATIONS')
    sql = {}
    for name, digest in MIGRATION_HASHES.items():
        contents = (MIGRATIONS / name / 'migration.sql').read_bytes()
        if hashlib.sha256(contents).hexdigest() != digest: raise ImportRefused('MIGRATION_CHECKSUM_CHANGED')
        sql[name] = contents.decode('utf-8')
    return sql


def export_rows(db):
    output, rows = {}, {}
    for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        columns = [row[1] for row in db.execute('PRAGMA table_info(' + quote(table) + ')')]
        projection = ','.join(map(quote, columns)) + ',' + ','.join('typeof(' + quote(column) + ')' for column in columns)
        values = db.execute('SELECT ' + projection + ' FROM ' + quote(table)).fetchall()
        width = len(columns)
        output[table] = {'columns': columns, 'rows': [[typed(value, row[width + index])
            for index, value in enumerate(row[:width])] for row in values]}
        rows[table] = [dict(zip(columns, row[:width])) for row in values]
    return output, rows


def valid_timestamp(value):
    if isinstance(value, int): return 0 <= value <= 8640000000000000
    if not isinstance(value, str) or not re.fullmatch(
            r'\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?', value):
        return False
    if 'T' in value and not re.search(r'(Z|[+-]\d{2}:\d{2})$', value): return False
    try: datetime.fromisoformat(value.replace('Z', '+00:00')); return True
    except ValueError: return False


def valid_day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value): return False
    try: date.fromisoformat(value); return True
    except ValueError: return False


def decoded_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    def reject_constant(_value): raise ValueError('NON_JSON_CONSTANT')
    return json.loads(text, object_pairs_hook=unique, parse_constant=reject_constant)


def known_json(table, column, text):
    if text is None: return True
    try: value = decoded_json(text)
    except (ValueError, TypeError): return False
    if column in ('actions', 'actionResult'): return value is None or value == []
    if table == 'Insight':
        return isinstance(value, list) and all(isinstance(item, str) and item in
            ('expense', 'habit', 'mood', 'diary', 'quicknote', 'todo', 'schedule', 'goal') for item in value)
    if not isinstance(value, dict) or not set(value) <= {'expenses', 'diary', 'mood', 'moodScore', 'habits', 'todos'}:
        return False
    if 'diary' in value and value['diary'] is not None and not isinstance(value['diary'], str): return False
    if 'mood' in value and value['mood'] not in (None, 'happy', 'good', 'normal', 'low', 'sad', 'angry', 'anxious'): return False
    if 'moodScore' in value and (type(value['moodScore']) is not int or not 1 <= value['moodScore'] <= 10): return False
    for key in ('expenses', 'habits', 'todos'):
        if key not in value: continue
        if not isinstance(value[key], list): return False
        for item in value[key]:
            if key == 'todos':
                if not isinstance(item, str): return False
            elif key == 'expenses':
                if (not isinstance(item, dict) or set(item) != {'name', 'amount', 'category', 'confirmed'} or
                    not isinstance(item['name'], str) or not isinstance(item['category'], str) or
                    type(item['amount']) is not int or not 0 < item['amount'] <= 10000000000 or
                    type(item['confirmed']) is not bool): return False
            elif (not isinstance(item, dict) or set(item) != {'name', 'done', 'confirmed'} or
                  not isinstance(item['name'], str) or type(item['done']) is not bool or type(item['confirmed']) is not bool):
                return False
    return True


def inspect_source(db, rows, sql):
    conflicts = []
    def conflict(code, table=None, source_ids=None, **detail):
        conflicts.append({'code': code, 'table': table, 'source_ids': [typed(value) for value in (source_ids or [])], **detail})
    history_columns = [(row[1], row[2], row[3], row[4], row[5]) for row in db.execute('PRAGMA table_info(_prisma_migrations)')]
    extra_history_objects = db.execute("SELECT name FROM sqlite_master WHERE tbl_name='_prisma_migrations' AND type!='table' AND name NOT GLOB 'sqlite_*'").fetchall()
    if history_columns != HISTORY_COLUMNS or extra_history_objects: conflict('UNSUPPORTED_MIGRATION_HISTORY_SCHEMA')
    history = rows.get('_prisma_migrations', [])
    names = [row.get('migration_name') for row in history]
    if (sorted(names, key=str) not in [list(MIGRATION_HASHES)[:1], list(MIGRATION_HASHES)[:2]] or any(
            row.get('finished_at') is None or row.get('rolled_back_at') is not None or row.get('applied_steps_count') != 1 or
            row.get('checksum') != MIGRATION_HASHES.get(row.get('migration_name')) or
            not isinstance(row.get('id'), str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', row['id']) or
            not valid_timestamp(row.get('started_at')) or not valid_timestamp(row.get('finished_at')) for row in history)):
        conflict('UNSUPPORTED_MIGRATION_HISTORY')
    with closing(sqlite3.connect(':memory:')) as expected:
        expected.executescript(sql[next(iter(MIGRATION_HASHES))])
        if schema_objects(db) != schema_objects(expected): conflict('UNSUPPORTED_SOURCE_SCHEMA')
        columns = {table: expected.execute('PRAGMA table_info(' + quote(table) + ')').fetchall() for table in TABLES}
    if conflicts: return conflicts, []
    for table, rowid, parent, _ in db.execute('PRAGMA foreign_key_check'):
        conflict('OWNER_OR_PARENT_MISSING', table, [rowid], parent_table=parent)
    owners = {row['id'] for row in rows['User']}
    habits = {row['id']: row['userId'] for row in rows['Habit']}
    sessions = {row['id']: row['userId'] for row in rows['ChatSession']}
    insights = {row['id']: row['userId'] for row in rows['Insight']}
    mappings = []
    for table in TABLES:
        for row in rows[table]:
            owner = row.get('userId')
            if table == 'User': owner = row['id']
            if table == 'HabitCheckin': owner = habits.get(row['habitId'])
            if table == 'ChatMessage': owner = sessions.get(row['sessionId'])
            if table in AUTH_TABLES: owner = None
            elif owner not in owners: conflict('UNVERIFIED_OWNER', table, [row['id']])
            target_id = 'legacy-diary-' + str(row['id']) if table == 'Diary' else row['id']
            if table == 'HabitCheckin': target_id = 'legacy-checkin-' + str(row['id'])
            mapping = {'table': table, 'source_id': typed(row['id']),
                       'target_id': target_id if isinstance(target_id, str) else None,
                       'owner_id': owner if isinstance(owner, str) else None, 'original_owner_id': typed(owner),
                       'parent_id': typed(row.get('habitId', row.get('sessionId'))),
                       'disposition': 'archive_only_auth' if table in AUTH_TABLES else 'candidate'}
            if table == 'HabitCheckin':
                mapping['sync_entity_id'] = row['habitId'] + '|' + row['date'] if isinstance(row['habitId'], str) and isinstance(row['date'], str) else None
            mappings.append(mapping)
            for _, column, kind, not_null, _, _ in columns[table]:
                value = row[column]
                if value is None:
                    if not_null: conflict('NULL_REQUIRED_FIELD', table, [row['id']], column=column)
                    continue
                valid = (isinstance(value, str) if kind == 'TEXT' else
                         isinstance(value, int) and value in (0, 1) if kind == 'BOOLEAN' else
                         valid_timestamp(value) if kind == 'DATETIME' else isinstance(value, int))
                if not valid: conflict('UNSUPPORTED_FIELD_VALUE', table, [row['id']], column=column)
                if kind == 'INTEGER' and column != 'id' and isinstance(value, int) and not -2147483648 <= value <= 2147483647:
                    conflict('UNSAFE_PRISMA_INTEGER', table, [row['id']], column=column)
            if table in SYNC_TABLES and table not in ('Diary', 'HabitCheckin'):
                if not isinstance(row['id'], str) or not 8 <= len(row['id']) <= 64: conflict('UNSUPPORTED_SYNC_ID', table, [row['id']])
            if table == 'HabitCheckin': conflict('MISSING_HISTORICAL_CREATED_AT', table, [row['id']], column='createdAt')
            if table == 'User':
                if not isinstance(row['id'], str) or not row['id'] or not isinstance(row['phone'], str) or not re.fullmatch(r'1[3-9]\d{9}', row['phone']):
                    conflict('UNSUPPORTED_ACCOUNT_IDENTITY', table, [row['id']])
                if (row['coachStyle'] not in ('gentle', 'strict', 'data') or not isinstance(row['pushLimit'], int) or not 0 <= row['pushLimit'] <= 10 or
                        any(not isinstance(row[key], str) or not re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', row[key]) for key in ('quietStart', 'quietEnd'))):
                    conflict('INVALID_ACCOUNT_PREFERENCES', table, [row['id']])
            if table == 'QuickNote' and (not isinstance(row['timestamp'], int) or not 0 <= row['timestamp'] <= 8640000000000000):
                conflict('UNSAFE_CLIENT_INTEGER', table, [row['id']], column='timestamp')
            if table == 'Expense' and (not isinstance(row['amount'], int) or not 0 < row['amount'] <= 10000000000):
                conflict('UNSUPPORTED_AMOUNT', table, [row['id']], column='amount')
            for column in {'QuickNote': ('parsed',), 'ChatMessage': ('actions',), 'Insight': ('dataSources', 'actionResult'), 'Push': ('actions',)}.get(table, ()):
                if not known_json(table, column, row[column]): conflict('JSON_OR_REFERENCE_REVIEW_REQUIRED', table, [row['id']], column=column)
            if table in ('Schedule', 'Expense', 'Diary', 'HabitCheckin') and not valid_day(row['date']):
                conflict('INVALID_BUSINESS_DATE', table, [row['id']], column='date')
            if table == 'Todo' and row['dueDate'] is not None and not valid_day(row['dueDate']):
                conflict('INVALID_BUSINESS_DATE', table, [row['id']], column='dueDate')
            domains = {'Schedule': {'type': ('class', 'study', 'work', 'social', 'other'), 'repeat': ('none', 'weekly')},
                       'Todo': {'priority': ('high', 'medium', 'low')}, 'Habit': {'frequency': ('daily', 'weekly')},
                       'ChatMessage': {'role': ('user', 'assistant', 'system')}}
            for column, accepted in domains.get(table, {}).items():
                if row[column] not in accepted: conflict('UNSUPPORTED_DOMAIN_VALUE', table, [row['id']], column=column)
            ranges = {'Schedule': {'remind': (0, 1440)}, 'Habit': {'sortOrder': (0, 10000)},
                      'Diary': {'moodScore': (1, 10)}, 'User': {'ignoredCount': (0, 2147483647)}}
            for column, (minimum, maximum) in ranges.get(table, {}).items():
                value = row[column]
                if value is not None and (not isinstance(value, int) or not minimum <= value <= maximum):
                    conflict('UNSUPPORTED_DOMAIN_VALUE', table, [row['id']], column=column)
            if table == 'Schedule':
                times = [row['startTime'], row['endTime']]
                if not all(isinstance(value, str) and re.fullmatch(r'([01]\d|2[0-3]):[0-5]\d', value) for value in times) or times[0] >= times[1]:
                    conflict('INVALID_SCHEDULE_TIMES', table, [row['id']])
            if table == 'Push' and row['insightId'] is not None and insights.get(row['insightId']) != owner:
                conflict('CROSS_OWNER_OR_MISSING_INSIGHT', table, [row['id']], parent_table='Insight')
    for table, keys in [('Diary', ('userId', 'date')), ('HabitCheckin', ('habitId', 'date'))]:
        groups = defaultdict(list)
        for row in rows[table]: groups[tuple(row[key] for key in keys)].append(row['id'])
        for ids in groups.values():
            if len(ids) > 1: conflict('DUPLICATE_BUSINESS_KEY_ALL_MEMBERS_BLOCKED', table, ids)
    for mapping in mappings:
        mapping['reasons'] = [item['code'] for item in conflicts if item['table'] == mapping['table'] and mapping['source_id'] in item['source_ids']]
        if mapping['disposition'] == 'archive_only_auth': mapping['target_id'] = None
        else: mapping['disposition'] = 'blocked_conflict' if mapping['reasons'] else ('blocked_by_batch' if conflicts else 'import')
    return conflicts, mappings


def target_rows(rows):
    result = {table: [] for table in TABLES}
    for table in TABLES:
        if table in AUTH_TABLES: continue
        for original in rows[table]:
            row = dict(original)
            if table == 'Diary': row['id'] = 'legacy-diary-' + str(row['id'])
            if table in ('Expense', 'QuickNote', 'Habit'): row['updatedAt'] = row['createdAt']
            if table == 'Expense': row.update(isIncome=0, note=None)
            if table == 'Todo': row['completedAt'] = None
            if table == 'Schedule': row['exceptions'] = '[]'
            if table == 'ChatMessage': row['source'] = 'legacy'
            result[table].append(row)
    return result


def insert_rows(db, table, rows):
    for row in rows:
        columns = list(row)
        db.execute('INSERT INTO ' + quote(table) + ' (' + ','.join(map(quote, columns)) + ') VALUES (' +
                   ','.join('?' for _ in columns) + ')', [row[column] for column in columns])


def build_target(bundle, rows, sql):
    data = bundle / 'data'; data.mkdir(mode=0o700)
    prisma = bundle / 'prisma'; prisma.mkdir(mode=0o700)
    (prisma / 'schema.prisma').write_text('datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}\n')
    (prisma / 'migrations').mkdir(mode=0o700)
    (prisma / 'migrations/migration_lock.toml').write_text('provider = "sqlite"\n')
    for name, text in sql.items():
        directory = prisma / 'migrations' / name; directory.mkdir(mode=0o700)
        (directory / 'migration.sql').write_text(text)
    env = {'PATH': os.environ.get('PATH', ''), 'HOME': str(bundle), 'DATABASE_URL': 'file:' + str(data / DB_NAME),
           'CHECKPOINT_DISABLE': '1', 'PRISMA_HIDE_UPDATE_MESSAGE': '1'}
    with (bundle / 'migration.log').open('x') as log:
        result = subprocess.run(['node', str(SERVER / 'node_modules/prisma/build/index.js'), 'migrate', 'deploy',
                                 '--schema', str(prisma / 'schema.prisma')], cwd=bundle, env=env,
                                stdout=log, stderr=subprocess.STDOUT, timeout=120)
    if result.returncode: raise ImportRefused('EMPTY_TARGET_MIGRATION_FAILED')
    converted = target_rows(rows)
    with closing(sqlite3.connect(data / DB_NAME)) as db:
        db.execute('PRAGMA foreign_keys=ON')
        with db:
            for table in TABLES: insert_rows(db, table, converted[table])
            for user in rows['User']:
                insert_rows(db, 'AccountPreferences', [{'userId': user['id'], 'coachStyle': user['coachStyle'],
                    'pushLimit': user['pushLimit'], 'quietStart': user['quietStart'], 'quietEnd': user['quietEnd']}])
            for table in TABLES:
                columns = list(converted[table][0]) if converted[table] else []
                if db.execute('SELECT COUNT(*) FROM ' + quote(table)).fetchone()[0] != len(converted[table]):
                    raise ImportRefused('TARGET_ROW_COUNT_MISMATCH')
                for row in converted[table]:
                    stored = db.execute('SELECT ' + ','.join(map(quote, columns)) + ' FROM ' + quote(table) + ' WHERE id=?', (row['id'],)).fetchone()
                    if stored != tuple(row[column] for column in columns): raise ImportRefused('TARGET_RAW_VALUE_MISMATCH')
            if db.execute('SELECT COUNT(*) FROM SyncChange').fetchone()[0] != sum(len(rows[table]) for table in SYNC_TABLES):
                raise ImportRefused('TARGET_SYNC_EVENT_COUNT_MISMATCH')
            for table, entity in SYNC_TABLES.items():
                for row in converted[table]:
                    event = db.execute('SELECT userId,entityId,payload FROM SyncChange WHERE entity=? AND entityId=?', (entity, row['id'])).fetchall()
                    if len(event) != 1 or event[0][0] != row['userId'] or json.loads(event[0][2])['id'] != row['id']:
                        raise ImportRefused('TARGET_SYNC_IDENTITY_MISMATCH')
            if db.execute('PRAGMA foreign_key_check').fetchall(): raise ImportRefused('TARGET_FOREIGN_KEY_MISMATCH')
    check_database(data / DB_NAME)
    with closing(sealed_connection(data / DB_NAME)) as db, closing(sqlite3.connect(':memory:')) as expected:
        for text in sql.values(): expected.executescript(text)
        if schema_objects(db) != schema_objects(expected): raise ImportRefused('TARGET_SCHEMA_MISMATCH')
        history = dict(db.execute('SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'))
        if history != MIGRATION_HASHES: raise ImportRefused('TARGET_HISTORY_MISMATCH')
    snapshot(data / DB_NAME, bundle / 'imported.sqlite3')
    sync_directory(bundle)
    write_new_json(bundle / 'candidate.json', {'format': 1, 'status': 'validation_passed_activation_blocked',
        'imported_counts': {table: len(converted[table]) for table in TABLES},
        'archive_only_counts': {table: len(rows[table]) for table in AUTH_TABLES}, 'deployment_authorized': False,
        'client_cutover_required': True, 'fresh_session_key_required': True, 'installation_enrolled': False})
    # NEVER make an installation marker, including on success. No automatic activation.
    return data


def _run(source, output):
    source, receipt = require_sealed(source)
    output = Path(output)
    if not output.is_absolute(): raise ImportRefused('ABSOLUTE_OUTPUT_REQUIRED')
    real_path(output.parent, directory=True)
    sql = migration_sql()
    output.mkdir(mode=0o700, exist_ok=False)
    try:
        archive = output / 'source.sqlite3'
        with source.open('rb') as origin, archive.open('xb') as dest:
            shutil.copyfileobj(origin, dest); dest.flush(); os.fsync(dest.fileno())
        if digest_file(archive) != receipt['sha256']: raise ImportRefused('SOURCE_CHANGED_DURING_COPY')
        write_new_json(Path(str(archive) + '.json'), receipt)
        with closing(sealed_connection(archive)) as db:
            if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]: raise ImportRefused('SOURCE_INTEGRITY_FAILED')
            raw, rows = export_rows(db)
            write_new_json(output / 'source-export.json', {'format': 1, 'encoding': 'sqlite-typed-values-v1', 'tables': raw})
            conflicts, mappings = inspect_source(db, rows, sql)
        write_new_json(output / 'plan.json', {'format': 1, 'source_sha256': receipt['sha256'], 'target_migrations': MIGRATION_HASHES,
            'source_counts': {table: len(value) for table, value in rows.items()}, 'mappings': mappings,
            'conflicts': conflicts, 'status': 'blocked' if conflicts else 'unambiguous',
            'rules': ['Source is read-only; no merge, winner selection, or migration history editing.',
                      'Expense/QuickNote/Habit updatedAt copies known createdAt as structural baseline, not historical last-edit evidence.',
                      'Todo completedAt stays NULL; missing HabitCheckin createdAt blocks import.',
                      'Original JSON/text is not reserialized or rewritten; unknown references require review.',
                      'AuthChallenge/RegistrationTicket are archive-only; target auth tables stay empty.',
                      'New sync history requires separately reviewed client cursor/outbox and session cutover.']})
        if conflicts: return 2
        build_target(output, rows, sql)
        return 0
    except Exception as exc:
        if not (output / 'failure.json').exists():
            write_new_json(output / 'failure.json', {'format': 1, 'status': 'failed_unenrolled', 'source_preserved': True,
                'code': str(exc) if isinstance(exc, ImportRefused) else type(exc).__name__,
                'instruction': 'Keep all files. Diagnose offline; retry only in another NEW directory.'})
        raise


def run(source, output):
    previous_umask = os.umask(0o077)
    try: return _run(source, output)
    finally: os.umask(previous_umask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Absolute sealed SQLite backup with matching .json SHA receipt')
    parser.add_argument('--new-output-dir', required=True, help='Absolute nonexistent directory with existing real parent')
    args = parser.parse_args()
    try: result = run(args.source, args.new_output_dir)
    except (ValueError, OSError, sqlite3.Error, subprocess.SubprocessError):
        print('Import refused or incomplete. Source unchanged; inspect private evidence if created. Never enrol an incomplete target.', file=sys.stderr)
        return 1
    print('Verified offline candidate, NOT enrolled. Session/client cutover approval is required before activation.' if result == 0 else
          'Import blocked. All originals retained privately; inspect plan.json conflicts. No target database enrolled.')
    return result


if __name__ == '__main__': sys.exit(main())
