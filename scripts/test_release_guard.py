"""A history reset or stale source must never trigger a deployment."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("release_guard", Path(__file__).with_name("check-release-source.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class ReleaseGuardTests(unittest.TestCase):
    def test_only_verified_current_main_with_a_parent_can_deploy(self):
        sha = "a" * 40
        commit = {"sha": sha, "parents": [{"sha": "b" * 40}], "commit": {"verification": {"verified": True}}}
        self.assertTrue(guard.eligible(commit, sha))
        self.assertFalse(guard.eligible(dict(commit, parents=[]), sha))
        self.assertFalse(guard.eligible(dict(commit, sha="c" * 40), sha))
        self.assertFalse(guard.eligible(dict(commit, commit={"verification": {"verified": False}}), sha))
        self.assertFalse(guard.eligible({}, sha))


if __name__ == "__main__":
    unittest.main()
