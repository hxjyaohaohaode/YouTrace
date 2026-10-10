"""No network, sudo or system installation. Synthetic bundles, real SHA checks."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('prereq', Path(__file__).parents[1] / 'ci-prerequisites.py')
prereq = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prereq)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name) / 'bundle'
        self.bundle.mkdir()
        (self.bundle / 'archives').mkdir()
        (self.bundle / 'lists').mkdir()
        (self.bundle / 'sources.list').write_text(prereq.SOURCES)
        (self.bundle / 'lists/authenticated-index').write_text('synthetic index, not a signature claim')
        self.packages = {}
        for name in prereq.TARGETS:
            rel = f'archives/{name}_1_all.deb'
            (self.bundle / rel).write_bytes(f'synthetic {name}'.encode())
            self.packages[rel] = dict(name=name, version='1', architecture='all')
        self.identity = dict(release='24.04', architecture='amd64', GITHUB_SHA='a' * 40,
                             GITHUB_RUN_ID='123', GITHUB_RUN_ATTEMPT='1', PREREQ_WORKFLOW_SHA='b' * 40,
                             ImageOS='ubuntu24', ImageVersion='old', workflow_sha256='c' * 64, helper_sha256='d' * 64)
        self.meta = patch.object(prereq, 'package_metadata', side_effect=lambda path: self.packages[path.relative_to(self.bundle).as_posix()])
        self.meta.start()
        self.addCleanup(self.meta.stop)
        self.manifest = dict(schema=1, identity=self.identity, targets=prereq.TARGETS,
                             packages=self.packages, files=prereq.file_manifest(self.bundle))
        self.seal()

    def seal(self):
        path = self.bundle / 'manifest.json'
        path.write_text(json.dumps(self.manifest))
        self.sha = prereq.digest(path)

    def check(self, identity=None):
        return prereq.validate(self.bundle, identity or self.identity, self.sha)

    def test_valid_and_rolling_image(self):
        self.check()
        self.check({**self.identity, 'ImageVersion': 'new'})

    def test_context_mismatch(self):
        for field in ('release', 'architecture', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'PREREQ_WORKFLOW_SHA', 'workflow_sha256', 'helper_sha256'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check({**self.identity, field: 'wrong'})

    def test_manifest_tamper(self):
        (self.bundle / 'manifest.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.check()

    def test_manifest_special_types_fail_before_read(self):
        path = self.bundle / 'manifest.json'
        original = path.read_text()
        for kind in ('symlink', 'directory', 'fifo'):
            with self.subTest(kind=kind):
                path.unlink()
                if kind == 'symlink':
                    path.symlink_to('/etc/passwd')
                elif kind == 'directory':
                    path.mkdir()
                else:
                    os.mkfifo(path)
                with self.assertRaisesRegex(ValueError, 'Manifest'):
                    self.check()
                if kind == 'directory':
                    path.rmdir()
                else:
                    path.unlink()
                path.write_text(original)

    def test_corrupt_package(self):
        (self.bundle / next(iter(self.packages))).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'bytes'):
            self.check()

    def test_missing_package(self):
        (self.bundle / next(iter(self.packages))).unlink()
        with self.assertRaises(ValueError):
            self.check()

    def test_extra_package(self):
        (self.bundle / 'archives/evil.deb').write_bytes(b'evil')
        with self.assertRaises(ValueError):
            self.check()

    def test_symlink(self):
        (self.bundle / 'archives/link').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'Symlinks'):
            self.check()

    def test_traversal_and_unsafe_names(self):
        for name in ('../escape', '/tmp/escape', 'archives/../../escape', 'archives/a\nb', 'archives/-x', 'archives/a/b', 'lists//a'):
            with self.subTest(name=name):
                self.manifest['files'] = {name: 'a' * 64}
                self.seal()
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    self.check()

    def test_unapproved_source(self):
        (self.bundle / 'sources.list').write_text('deb [trusted=yes] https://evil.invalid noble main')
        self.manifest['files'] = prereq.file_manifest(self.bundle)
        self.seal()
        with self.assertRaisesRegex(ValueError, 'source'):
            self.check()

    def test_control_field_mismatch(self):
        self.meta.stop()
        with patch.object(prereq, 'package_metadata', return_value=dict(name='wrong', version='2', architecture='all')):
            with self.assertRaisesRegex(ValueError, 'metadata'):
                self.check()

    def test_install_is_offline_and_pins_targets(self):
        with patch.object(prereq, 'run') as run:
            prereq.install(self.bundle, self.identity, self.sha)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual(len(commands), 3)
        for command in commands[:2]:
            self.assertIn('--no-download', command)
            self.assertIn('--no-remove', command)
            self.assertIn('APT::Get::allow-Downgrades=false', command)
            self.assertIn('APT::Get::AllowUnauthenticated=false', command)
            self.assertNotIn('update', command)
            self.assertIn('ffmpeg=1', command)
        self.assertIn('--simulate', commands[0])
        self.assertEqual(commands[1][:3], ['sudo', 'env', 'DEBIAN_FRONTEND=noninteractive'])

    def test_solver_failure_never_installs(self):
        with patch.object(prereq, 'run', side_effect=subprocess.CalledProcessError(100, 'apt-get')) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                prereq.install(self.bundle, self.identity, self.sha)
        self.assertEqual(run.call_count, 1)

    def test_tamper_never_invokes_install(self):
        (self.bundle / 'sources.list').write_text('bad')
        with patch.object(prereq, 'run') as run:
            with self.assertRaises(ValueError):
                prereq.install(self.bundle, self.identity, self.sha)
        run.assert_not_called()

    def test_apt_security_and_empty_state(self):
        args = prereq.apt_options(self.bundle, Path(self.temp.name), empty=True)
        for value in ('Acquire::AllowInsecureRepositories=false', 'Acquire::AllowDowngradeToInsecureRepositories=false', 'APT::Get::AllowUnauthenticated=false', 'Acquire::Retries=0', 'APT::Update::Error-Mode=any'):
            self.assertIn(value, args)
        self.assertIn(f'Dir::State::status={self.temp.name}/status', args)
        self.assertNotIn(f'Dir::State::status={self.temp.name}/status', prereq.apt_options(self.bundle, Path(self.temp.name)))

    def test_network_failure_never_publishes_manifest(self):
        other = Path(self.temp.name) / 'failed'
        with patch.object(prereq, 'run', side_effect=subprocess.CalledProcessError(100, 'apt-get')):
            with self.assertRaises(subprocess.CalledProcessError):
                prereq.prepare(other, self.identity)
        self.assertFalse((other / 'manifest.json').exists())

    def test_workflow_keeps_budgets_probes_and_all_matrix_tasks(self):
        workflow = (Path(__file__).parents[3] / '.github/workflows/ci.yml').read_text()
        original_jobs, render_job = workflow.split('\n  render_image:', 1)
        self.assertEqual(original_jobs.count('timeout-minutes: 20'), 3)
        self.assertEqual(render_job.count('timeout-minutes: 20'), 1)
        self.assertIn('docker build --file deploy/render/Dockerfile', render_job)
        self.assertIn('test \"$result\" -eq 1', render_job)
        self.assertIn('Render startup refused', render_job)
        self.assertEqual(workflow.count('timeout-minutes: 8'), 1)
        self.assertEqual(workflow.count('45s bash scripts/recording-prereq-probe.sh'), 2)
        self.assertEqual(workflow.count('needs: prepare_prerequisites'), 2)
        self.assertEqual(workflow.count('actions/download-artifact@v4'), 2)
        self.assertNotIn('apt-get update', workflow)
        self.assertNotIn('continue-on-error', workflow)
        self.assertIn('node scripts/audit-user-outcomes.mjs', workflow)
        matrix = workflow.split('task_set: [', 1)[1].split(']', 1)[0]
        self.assertEqual(len(matrix.split(',')), 21)


class RealResolverTests(unittest.TestCase):
    """Real dpkg-deb and APT simulation with an isolated synthetic status file."""
    def resolve(self, dependency, installed, download_only=False):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            control = root / 'package/DEBIAN'
            control.mkdir(parents=True)
            (control / 'control').write_text(
                'Package: youtrace-prereq-fixture\nVersion: 1\nArchitecture: all\n'
                'Maintainer: CI Fixture <ci@example.invalid>\n'
                f'Depends: {dependency}\nDescription: synthetic resolver contract\n')
            deb = root / 'fixture.deb'
            subprocess.run(['dpkg-deb', '--build', str(control.parent), str(deb)], check=True, capture_output=True)
            self.assertEqual(prereq.package_metadata(deb), dict(name='youtrace-prereq-fixture', version='1', architecture='all'))
            status = root / 'status'
            status.write_text(installed)
            (root / 'lists/partial').mkdir(parents=True)
            (root / 'archives/partial').mkdir(parents=True)
            (root / 'sources.list').write_text('')
            args = ['apt-get', *prereq.apt_options(root, root, empty=True),
                    '--download-only' if download_only else '--simulate', '--no-download', '--no-remove', '-y', 'install', str(deb)]
            result = subprocess.run(args, capture_output=True, text=True, env=prereq.apt_environment(root))
            self.assertEqual(status.read_text(), installed)
            return result

    def installed(self, version):
        return ('Package: youtrace-fixture-lib\nStatus: install ok installed\n'
                f'Version: {version}\nArchitecture: all\n'
                'Maintainer: CI Fixture <ci@example.invalid>\nDescription: synthetic dependency\n\n')

    def test_higher_compatible_dependency_is_retained(self):
        result = self.resolve('youtrace-fixture-lib (>= 1)', self.installed('2'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Inst youtrace-prereq-fixture', result.stdout)
        self.assertNotIn('Inst youtrace-fixture-lib', result.stdout)

    def test_missing_offline_dependency_fails(self):
        result = self.resolve('youtrace-fixture-lib (>= 1)', '')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('youtrace-fixture-lib', result.stdout + result.stderr)

    def test_root_downgrade_is_rejected_before_installation(self):
        status = self.installed('2').replace('youtrace-fixture-lib', 'youtrace-prereq-fixture')
        result = self.resolve('', status, download_only=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('downgrad', (result.stdout + result.stderr).lower())

    def test_unsigned_local_repository_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'repo').mkdir()
            (root / 'repo/Packages').write_text('')
            (root / 'repo/Release').write_text('Origin: Synthetic unsigned fixture\nLabel: Synthetic\nSuite: fixture\nCodename: fixture\nArchitectures: amd64\n')
            (root / 'sources.list').write_text(f'deb file:{root}/repo ./\n')
            (root / 'status').write_text('')
            (root / 'lists/partial').mkdir(parents=True)
            (root / 'archives/partial').mkdir(parents=True)
            result = subprocess.run(['apt-get', *prereq.apt_options(root, root, empty=True), 'update'],
                                    capture_output=True, text=True, env=prereq.apt_environment(root))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not signed', result.stdout + result.stderr)
            self.assertEqual((root / 'status').read_text(), '')

    def test_real_version_conflict_fails(self):
        result = self.resolve('youtrace-fixture-lib (<< 2)', self.installed('2'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('youtrace-fixture-lib', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
