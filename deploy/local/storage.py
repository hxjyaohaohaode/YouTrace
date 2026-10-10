"""Private SQLite snapshots. No provider calls, credentials, or production discovery."""
import argparse
from contextlib import closing
import time
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone

INSTALL = '.youtrace-local.json'
DB_NAME = 'youtrace.sqlite3'

def require_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected an existing regular file, not a symlink')
    return path

def connect_readonly(path):
    return sqlite3.connect(require_file(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=10)

def check_database(path):
    with closing(connect_readonly(path)) as db:
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('SQLite foreign key check failed')
        return db.execute('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name').fetchall()

def require_install(directory):
    directory = Path(directory)
    marker = json.loads(require_file(directory / INSTALL).read_text())
    if marker != {'format': 1, 'database': DB_NAME}:
        raise ValueError('Unknown local installation marker')
    require_file(directory / DB_NAME)

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def write_new_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, sort_keys=True)
        out.flush()
        os.fsync(out.fileno())
    sync_directory(Path(path).parent)

def make_marker(directory):
    write_new_json(Path(directory) / INSTALL, {'format': 1, 'database': DB_NAME})

def snapshot(source, output):
    source, output = require_file(source), Path(output)
    receipt = Path(str(output) + '.json')
    if source.resolve() == output.resolve():
        raise ValueError('Backup cannot replace source')
    if any(Path(str(output) + suffix).exists() or Path(str(output) + suffix).is_symlink()
           for suffix in ('', '.json', '-wal', '-shm', '-journal')):
        raise ValueError('Backup target or sidecar already exists')
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    # Preserve failed outputs for investigation; never overwrite or silently clean them.
    deadline = time.monotonic() + 60
    def progress(_status, _remaining, _total):
        if time.monotonic() > deadline:
            raise TimeoutError('Backup exceeded 60 seconds; incomplete output retained')
    with closing(connect_readonly(source)) as origin, closing(sqlite3.connect(output)) as dest:
        origin.backup(dest, pages=256, progress=progress)
        # Seal the independent backup: do not leave inherited WAL mode/sidecars.
        if dest.execute('PRAGMA journal_mode=DELETE').fetchone() != ('delete',):
            raise ValueError('Could not seal backup journal mode')
    check_database(output)
    with output.open('rb') as saved:
        digest = hashlib.file_digest(saved, 'sha256').hexdigest()
    write_new_json(receipt, {'format': 1, 'sha256': digest,
                            'created_at': datetime.now(timezone.utc).isoformat()})
    return digest

def restore(source, directory):
    source, directory = require_file(source), Path(directory)
    receipt = json.loads(require_file(str(source) + '.json').read_text())
    if receipt.get('format') != 1 or not isinstance(receipt.get('sha256'), str):
        raise ValueError('Unknown backup receipt')
    if any(Path(str(source) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
        raise ValueError('Restore only a sealed backup without active sidecars')
    # Only a brand-new target is supported. Verify the exact bytes copied, not a
    # source hash checked before copying that could change in between.
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    output = directory / DB_NAME
    digest = hashlib.sha256()
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with source.open('rb') as origin, os.fdopen(fd, 'wb') as dest:
        while chunk := origin.read(1024 * 1024):
            digest.update(chunk)
            dest.write(chunk)
        dest.flush()
        os.fsync(dest.fileno())
    if receipt['sha256'] != digest.hexdigest():
        raise ValueError('Backup receipt mismatch; rejected copy retained without installation marker')
    check_database(output)
    make_marker(directory)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation', required=True)
    back = sub.add_parser('backup')
    back.add_argument('--data-dir', required=True)
    back.add_argument('--output', required=True)
    recover = sub.add_parser('restore')
    recover.add_argument('--source', required=True)
    recover.add_argument('--new-data-dir', required=True)
    args = parser.parse_args()
    if args.operation == 'backup':
        require_install(args.data_dir)
        snapshot(Path(args.data_dir) / DB_NAME, args.output)
    else:
        restore(args.source, args.new_data_dir)
    print('Verified private SQLite copy created; do not publish it.')

if __name__ == '__main__':
    main()
