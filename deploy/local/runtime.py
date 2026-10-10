"""Single-process local production supervisor; Linux container only."""
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit
from storage import DB_NAME, INSTALL, require_install, snapshot, make_marker


def validate_environment(environ):
    if environ.get('NODE_ENV') != 'production':
        raise ValueError('This launcher requires NODE_ENV=production')
    secret = environ.get('JWT_SECRET', '').strip()
    if len(secret) < 32 or 'local-development-only' in secret or 'replace-before' in secret:
        raise ValueError('Set a private production JWT_SECRET of at least 32 characters')
    if environ.get('DEV_OTP_EXPOSE', '').strip().lower() == 'true':
        raise ValueError('Development OTP cannot be enabled')
    origins = environ.get('ALLOWED_ORIGINS', '').split(',')
    for origin in origins:
        parsed = urlsplit(origin.strip())
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError('ALLOWED_ORIGINS must contain explicit HTTPS origins')
    if not environ.get('SMS_PROVIDER_URL', '').strip() or not environ.get('SMS_PROVIDER_TOKEN', '').strip():
        raise ValueError('Production login requires your existing SMS provider URL and token')
    sms = urlsplit(environ['SMS_PROVIDER_URL'])
    if sms.scheme != 'https' or not sms.hostname or sms.username or sms.password:
        raise ValueError('Production SMS provider must use HTTPS without URL credentials')
    directory = Path(environ.get('DATA_DIR', ''))
    if not directory.is_absolute() or directory.is_symlink() or not directory.is_dir():
        raise ValueError('DATA_DIR must be an existing absolute persistent directory')
    expected = 'file:' + str(directory / DB_NAME)
    if environ.get('DATABASE_URL', expected) != expected:
        raise ValueError('DATABASE_URL must match DATA_DIR/youtrace.sqlite3 exactly')
    return directory


def prepare_data(directory, initialize):
    db = directory / DB_NAME
    if not (directory / INSTALL).exists():
        if not initialize:
            raise ValueError('No enrolled installation. Explicit empty initialization is required')
        if any(directory.iterdir()):
            # The supervisor lock is the only allowed entry in an empty volume.
            if any(p.name != '.runtime.lock' for p in directory.iterdir()):
                raise ValueError('Refusing to initialize a nonempty or unknown data directory')
        return False
    require_install(directory)
    return True


def main():
    os.umask(0o077)
    directory = validate_environment(os.environ)
    env = dict(os.environ, DATABASE_URL='file:' + str(directory / DB_NAME), TRUST_PROXY='false', DEV_OTP_EXPOSE='false')
    # Lock stays in this supervisor across migration and the entire API lifetime.
    lock_path = directory / '.runtime.lock'
    lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another managed process is using DATA_DIR') from None
        existing = prepare_data(directory, os.environ.get('YOU_TRACE_INITIALIZE_EMPTY') == 'true')
        if existing:
            backups = Path(os.environ.get('BACKUP_DIR', '/backups'))
            if not backups.is_absolute() or backups.is_symlink() or not backups.is_dir():
                raise ValueError('Missing persistent /backups directory')
            snapshot(directory / DB_NAME, backups / f'prestart-{time.time_ns()}.sqlite3')
        child = None
        stopped = False
        def stop(signum, _frame):
            nonlocal stopped
            stopped = True
            if child is not None and child.poll() is None:
                child.send_signal(signum)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        def run(command):
            nonlocal child
            if stopped:
                return 1
            child = subprocess.Popen(command, env=env)
            if stopped:
                child.terminate()
            return child.wait()
        result = run(['node', 'node_modules/prisma/build/index.js', 'migrate', 'deploy'])
        if result or stopped:
            return result or 1
        if not existing:
            make_marker(directory)
        return run(['node', 'dist/index.js'])

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print('Local startup refused: ' + str(exc), file=sys.stderr)
        sys.exit(1)
