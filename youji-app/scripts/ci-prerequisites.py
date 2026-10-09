#!/usr/bin/env python3
"""Run-scoped, authenticated Ubuntu APT snapshot for hosted CI only.

prepare downloads a complete dependency closure without installing anything.
install verifies every byte, then resolves against the real runner offline.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

TARGETS = ['fonts-noto-cjk', 'ffmpeg', 'fontconfig']
SOURCES = '''deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble main universe
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble-updates main universe
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu noble-security main universe
'''


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def identity(root):
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    arch = run(['dpkg', '--print-architecture'], capture_output=True).stdout.strip()
    if (release.get('ID'), release.get('VERSION_ID', '').strip('"'), arch) != ('ubuntu', '24.04', 'amd64'):
        raise ValueError('Requires Ubuntu 24.04 amd64; no local system changes allowed')
    names = ['GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'PREREQ_WORKFLOW_SHA', 'ImageOS', 'ImageVersion']
    values = {name: os.environ[name] for name in names}
    if not all(values.values()):
        raise ValueError('Missing hosted runner identity')
    return {**values, 'release': '24.04', 'architecture': arch,
            'workflow_sha256': digest(root / '.github/workflows/ci.yml'),
            'helper_sha256': digest(Path(__file__))}


def apt_environment(state):
    # APT_CONFIG is read before system config fragments. Do not inherit runner
    # repository overrides or Post-Invoke hooks; do not edit system configuration.
    (state / 'empty').mkdir(exist_ok=True)
    config = state / 'apt.conf'
    config.write_text(f'Dir::Etc::parts "{state / "empty"}";\nDir::Etc::main "/dev/null";\n')
    return {**os.environ, 'APT_CONFIG': str(config)}


def apt_options(bundle, state, empty=False):
    (state / 'empty').mkdir(exist_ok=True)
    # Never consume runner PPAs, stale lists, preferences or mutable caches.
    options = {
        'Dir::Etc::sourcelist': str(bundle / 'sources.list'),
        'Dir::Etc::sourceparts': str(state / 'empty'), 'Dir::Etc::preferences': '/dev/null',
        'Dir::Etc::preferencesparts': str(state / 'empty'), 'Dir::State::lists': str(bundle / 'lists'),
        'Dir::Cache::archives': str(bundle / 'archives'),
        'Dir::Cache::pkgcache': '', 'Dir::Cache::srcpkgcache': '',
        'Dir::State::extended_states': str(state / 'extended_states'),
        'Acquire::AllowInsecureRepositories': 'false',
        'Acquire::AllowDowngradeToInsecureRepositories': 'false',
        'APT::Get::AllowUnauthenticated': 'false',
        'APT::Get::allow-Downgrades': 'false',
        'APT::Update::Error-Mode': 'any', 'Acquire::Retries': '0',
        'Acquire::http::Timeout': '60', 'Acquire::https::Timeout': '60',
    }
    if empty:
        options['Dir::State::status'] = str(state / 'status')
    return [arg for key, value in options.items() for arg in ('-o', f'{key}={value}')]


def package_metadata(path):
    fields = run(['dpkg-deb', '--show', '--showformat=${Package}\t${Version}\t${Architecture}', str(path)], capture_output=True).stdout.split('\t')
    if (len(fields) != 3 or fields[2] not in ('amd64', 'all')
            or not re.fullmatch(r'[a-z0-9][a-z0-9+.-]+', fields[0])
            or not re.fullmatch(r'[0-9][A-Za-z0-9.+:~\-]*', fields[1])):
        raise ValueError('Invalid package metadata')
    return dict(zip(('name', 'version', 'architecture'), fields))


def file_manifest(bundle):
    result = {}
    for path in sorted(bundle.rglob('*')):
        if path.is_symlink():
            raise ValueError('Symlinks forbidden in prerequisite artifact')
        if path.is_file() and path != bundle / 'manifest.json':
            result[path.relative_to(bundle).as_posix()] = digest(path)
        elif not path.is_file() and not path.is_dir():
            raise ValueError('Special files forbidden')
    return result


def validate(bundle, expected, expected_digest):
    manifest_path = bundle / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or not re.fullmatch(r'[0-9a-f]{64}', expected_digest) or digest(manifest_path) != expected_digest:
        raise ValueError('Manifest digest mismatch')
    manifest = json.loads(manifest_path.read_text())
    # Runner images roll independently; record ImageVersion, but use the real
    # offline resolver (not a string comparison) as the compatibility gate.
    stable = lambda value: {k: v for k, v in value.items() if k != 'ImageVersion'}
    if manifest['schema'] != 1 or stable(manifest['identity']) != stable(expected) or manifest['targets'] != TARGETS:
        raise ValueError('Runner/workflow/run identity mismatch')
    for name in manifest['files']:
        path = Path(name)
        if (path.is_absolute() or '..' in path.parts or path.as_posix() != name
                or not re.fullmatch(r'(sources\.list|(?:lists|archives)/[A-Za-z0-9][A-Za-z0-9._+%:~-]*)', name)
                or not re.fullmatch(r'[0-9a-f]{64}', manifest['files'][name])):
            raise ValueError('Unsafe artifact path')
    if file_manifest(bundle) != manifest['files']:
        raise ValueError('Missing, extra or corrupt artifact bytes')
    if (bundle / 'sources.list').read_text() != SOURCES:
        raise ValueError('Unexpected repository source')
    packages = manifest['packages']
    actual = {p.relative_to(bundle).as_posix(): package_metadata(p) for p in sorted((bundle / 'archives').glob('*.deb'))}
    if actual != packages or not set(TARGETS).issubset({p['name'] for p in actual.values()}):
        raise ValueError('Package metadata or required package mismatch')
    return manifest


def prepare(bundle, expected):
    bundle.mkdir(parents=True, exist_ok=False)
    (bundle / 'sources.list').write_text(SOURCES)
    for part in ('lists/partial', 'archives/partial'):
        (bundle / part).mkdir(parents=True)
    with tempfile.TemporaryDirectory(prefix='youtrace-apt-state-', dir=bundle.parent) as temp:
        state = Path(temp)
        (state / 'status').touch()  # Full closure, not just packages absent on this image.
        options = apt_options(bundle, state, empty=True)
        env = apt_environment(state)
        run(['apt-get', *options, 'update'], env=env)  # Signed InRelease + Packages hash validation.
        run(['apt-get', *options, '--download-only', '--no-install-recommends', '--no-remove', '-y', 'install', *TARGETS], env=env)
    # APT locks/partial state are not part of the transferable immutable snapshot.
    for part in ('lists', 'archives'):
        (bundle / part / 'lock').unlink(missing_ok=True)
        shutil.rmtree(bundle / part / 'partial')
    packages = {p.relative_to(bundle).as_posix(): package_metadata(p) for p in sorted((bundle / 'archives').glob('*.deb'))}
    if not set(TARGETS).issubset({p['name'] for p in packages.values()}):
        raise ValueError('Incomplete prerequisite download')
    manifest = {'schema': 1, 'identity': expected, 'targets': TARGETS, 'packages': packages, 'files': file_manifest(bundle)}
    (bundle / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    checksum = digest(bundle / 'manifest.json')
    validate(bundle, expected, checksum)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'manifest_sha256={checksum}\n')
    total = sum(p.stat().st_size for p in (bundle / 'archives').glob('*.deb'))
    print(f'Prepared authenticated snapshot: {len(packages)} packages, {total} .deb bytes; manifest SHA256 {checksum}')


def install(bundle, expected, checksum):
    manifest = validate(bundle, expected, checksum)
    print(f"Producer image={manifest['identity']['ImageVersion']}; consumer image={expected['ImageVersion']}; resolving real installed state offline")
    versions = {p['name']: p['version'] for p in manifest['packages'].values()}
    targets = [f'{name}={versions[name]}' for name in TARGETS]
    with tempfile.TemporaryDirectory(prefix='youtrace-apt-install-', dir=bundle.parent) as temp:
        options = apt_options(bundle, Path(temp))
        env = apt_environment(Path(temp))
        args = ['apt-get', *options, '--no-download', '--no-install-recommends', '--no-remove', '-y']
        # No apt update, no fallback download, no ignore-missing or forced downgrade.
        run([*args, '--simulate', 'install', *targets], env=env)
        run(['sudo', 'env', 'DEBIAN_FRONTEND=noninteractive', f'APT_CONFIG={env["APT_CONFIG"]}', *args, 'install', *targets])
    run(['dpkg-query', '--show', '--showformat=${binary:Package}=${Version} ${db:Status-Status}\n', *TARGETS])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['prepare', 'install'])
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--manifest-sha256', default='')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    expected = identity(root)
    bundle = args.bundle.resolve()
    runner_temp = Path(os.environ['RUNNER_TEMP']).resolve()
    if not bundle.is_relative_to(runner_temp) or bundle == runner_temp or args.bundle.is_symlink():
        raise ValueError('Bundle must be a dedicated directory under RUNNER_TEMP')
    if args.mode == 'prepare':
        prepare(bundle, expected)
    else:
        install(bundle, expected, args.manifest_sha256)


if __name__ == '__main__':
    main()
