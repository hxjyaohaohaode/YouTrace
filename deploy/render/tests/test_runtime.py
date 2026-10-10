import importlib.util
from pathlib import Path
import unittest
import subprocess
import sys

spec = importlib.util.spec_from_file_location('render_gate', Path(__file__).parents[1] / 'runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RenderStorageGateTests(unittest.TestCase):
    def setUp(self):
        self.env = {'NODE_ENV': 'production', 'RENDER': 'true', 'DATA_DIR': '/var/data/youtrace',
                    'BACKUP_DIR': '/var/data/backups', 'DATABASE_URL': 'file:/var/data/youtrace/youtrace.sqlite3'}
        self.mount = '42 1 8:1 / /var/data rw,relatime - ext4 /dev/synthetic rw\n'

    def test_templates_never_offer_a_free_ephemeral_sqlite_api(self):
        root = Path(__file__).parents[3]
        production = (root / 'render.yaml').read_text()
        free = (root / 'deploy/render/free-static.yaml').read_text()
        self.assertIn('plan: 0.5c-512mb', production)
        self.assertIn('mountPath: /var/data', production)
        self.assertNotIn('plan: free', production)
        self.assertIn('runtime: static', free)
        self.assertNotIn('runtime: node', free)
        self.assertNotIn('runtime: docker', free)
        self.assertNotIn('DATABASE_URL', free)

    def test_declared_disk_layout_is_allowed(self):
        runtime.validate_storage(self.env, self.mount)

    def test_free_ephemeral_filesystem_is_refused(self):
        with self.assertRaises(ValueError):
            runtime.validate_storage(self.env, '1 0 0:1 / / rw - overlay overlay rw\n')

    def test_parent_mount_does_not_count_as_attached_disk(self):
        with self.assertRaises(ValueError):
            runtime.validate_storage(self.env, self.mount.replace('/var/data', '/var'))

    def test_readonly_disk_is_refused(self):
        with self.assertRaises(ValueError):
            runtime.validate_storage(self.env, self.mount.replace('rw,relatime', 'ro,relatime'))

    def test_all_paths_must_match_disk_layout(self):
        for name in ('DATA_DIR', 'BACKUP_DIR', 'DATABASE_URL'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                runtime.validate_storage({**self.env, name: '/tmp/unsafe'}, self.mount)

    def test_actual_free_start_fails_before_migrations_or_server(self):
        result = subprocess.run([sys.executable, str(Path(__file__).parents[1] / 'runtime.py')],
                                env={**self.env, 'YOU_TRACE_ALLOW_EPHEMERAL_SQLITE': 'true'},
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertIn('Render startup refused', result.stderr)
        self.assertNotIn('prisma', result.stderr)

    def test_not_a_local_development_launcher(self):
        for patch in ({'NODE_ENV': 'development'}, {'RENDER': ''}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                runtime.validate_storage({**self.env, **patch}, self.mount)


if __name__ == '__main__':
    unittest.main()
