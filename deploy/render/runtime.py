"""Render single-instance persistent-disk gate; never an ephemeral SQLite fallback."""
import os
from pathlib import Path
import sys


def validate_storage(environ, mountinfo):
    if environ.get('NODE_ENV') != 'production':
        raise ValueError('Render launcher requires production mode')
    if environ.get('RENDER') != 'true':
        raise ValueError('This launcher is only for a Render persistent-disk service')
    expected = {
        'DATA_DIR': '/var/data/youtrace',
        'BACKUP_DIR': '/var/data/backups',
        'DATABASE_URL': 'file:/var/data/youtrace/youtrace.sqlite3',
    }
    for name, value in expected.items():
        if environ.get(name) != value:
            raise ValueError(f'{name} must use the declared persistent-disk layout')
    # A writable directory alone is not proof of a persistent disk. Free services
    # have no mounted disk and must fail closed, even with matching env strings.
    mounts = [line.split() for line in mountinfo.splitlines()]
    if not any(len(fields) > 5 and fields[4] == '/var/data' and 'rw' in fields[5].split(',') for fields in mounts):
        raise ValueError('Required writable /var/data disk is not mounted; ephemeral SQLite is refused')


def main():
    validate_storage(os.environ, Path('/proc/self/mountinfo').read_text())
    for directory in ('/var/data/youtrace', '/var/data/backups'):
        path = Path(directory)
        if path.is_symlink():
            raise ValueError('Persistent directories cannot be symbolic links')
        path.mkdir(mode=0o700, exist_ok=True)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'local'))
    import runtime as local_runtime
    return local_runtime.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError):
        # Do not echo environment values or database contents in deployment logs.
        print('Render startup refused: verify persistent disk, directory permissions, production authentication, and installation enrollment.', file=sys.stderr)
        sys.exit(1)
