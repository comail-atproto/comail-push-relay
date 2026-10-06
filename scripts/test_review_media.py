"""Exercise policy against real Git diffs, including unusual paths and renames."""
from pathlib import Path
import subprocess
import tempfile
import unittest

script = Path(__file__).with_name('check-review-media.py')

class ReviewMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Policy test')
        self.git('config', 'user.email', 'policy@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.write('docs/pr-media/old.png')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, stderr=subprocess.STDOUT)
    def write(self, name):
        p = self.repo / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b'synthetic fixture')
    def check(self, ok, *args):
        result = subprocess.run(['python3', str(script.resolve()), *(args or ('--staged',))], cwd=self.repo, capture_output=True)
        self.assertEqual(result.returncode == 0, ok, result.stderr.decode())
    def test_product_assets_and_durable_docs_are_allowed(self):
        for name in ['public/logo.png', 'docs/architecture/flow.svg', 'screenshots/product.png']:
            self.write(name)
        self.git('add', '.')
        self.check(True)
    def test_evidence_directories_and_loose_captures_are_rejected(self):
        for name in ['pr-media/new.webp', 'docs/pr-media/new.png', 'nested/review-evidence/video.webm', 'pr-evidence/a.svg', 'before.png', 'docs/after-mobile.png', 'screenshot.png', 'docs/pr-media/line\nbreak.png']:
            with self.subTest(name=name):
                self.write(name)
                self.git('add', name)
                self.check(False)
                self.git('restore', '--staged', name)
    def test_historical_deletion_and_rename_are_rejected(self):
        self.git('mv', 'docs/pr-media/old.png', 'public-moved.png')
        self.check(False)
    def test_invalid_comparison_fails(self):
        self.check(False, 'missing-ref', 'HEAD')
    def test_committed_diff_is_checked(self):
        self.write('review-evidence/video.mp4')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture change')
        self.check(False, 'HEAD^', 'HEAD')

if __name__ == '__main__':
    unittest.main()
