import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).with_name('release-version.py')
SPEC = importlib.util.spec_from_file_location('release_version', SCRIPT)
release_version = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_version)


class ReleaseVersionTests(unittest.TestCase):
    def test_no_matching_change_does_not_release(self):
        self.assertIsNone(release_version.next_version('v0.1.0', ['docs: clarify setup']))

    def test_fix_and_perf_make_patch_release(self):
        self.assertEqual(release_version.next_version('v0.1.0', ['perf: reduce startup work']), 'v0.1.1')

    def test_feature_makes_minor_release_even_with_fixes(self):
        self.assertEqual(release_version.next_version('v0.1.0', ['fix: handle timeout', 'feat: add metrics']), 'v0.2.0')

    def test_breaking_change_bumps_minor_before_one(self):
        self.assertEqual(release_version.next_version('v0.1.0', ['feat!: replace endpoint']), 'v0.2.0')

    def test_breaking_change_bumps_major_after_zero(self):
        self.assertEqual(release_version.next_version('v1.4.2', ['feat: new endpoint\n\nBREAKING CHANGE: remove old endpoint']), 'v2.0.0')


if __name__ == '__main__':
    unittest.main()
