"""Check the repository entry point; the shared Git cases live in atmosphere-mail."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class ReviewMediaEntryPointTests(unittest.TestCase):
    def test_empty_diff_passes_and_unknown_revision_fails(self):
        script = Path(__file__).with_name('check-review-media.py')
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(['git', 'init', '-q', directory], check=True)
            subprocess.run(['git', '-c', 'user.name=Policy test', '-c', 'user.email=policy@example.invalid',
                            '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], cwd=directory, check=True)
            for revisions, status in [(('HEAD', 'HEAD'), 0), (('missing-policy-revision', 'HEAD'), 2)]:
                result = subprocess.run([sys.executable, str(script.resolve()), *revisions], cwd=directory, capture_output=True)
                self.assertEqual(result.returncode, status, result.stderr.decode())


class BundlePinTests(unittest.TestCase):
    def test_offline_bundle_matches_pin(self):
        scripts = Path(__file__).resolve().parent
        pin = json.loads((scripts / 'comail-policy.json').read_text())
        self.assertEqual(hashlib.sha256((scripts / 'comail-policy-0.1.0.pyz').read_bytes()).hexdigest(), pin['sha256'])


if __name__ == '__main__':
    unittest.main()
