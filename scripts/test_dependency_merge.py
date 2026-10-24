"""Keep repository merge wiring separate from the shared policy matrix."""
from pathlib import Path
import unittest
import sys

ROOT = Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    def test_no_persistent_native_merge_permission(self):
        workflow = (ROOT / '.github/workflows/dependency-automerge.yml').read_text()
        self.assertNotIn('--auto', workflow)
        self.assertNotIn('enablePullRequestAutoMerge', workflow)


class BundledApprovalTests(unittest.TestCase):
    def test_only_latest_matching_approval_can_authorize(self):
        sys.path.insert(0, str(ROOT / 'scripts/comail-policy-0.1.0.pyz'))
        try:
            from comail_policy.dependency_merge import approved
            sha = 'a' * 40
            matching = {'user': {'id': 41898282, 'login': 'github-actions[bot]'},
                        'state': 'APPROVED', 'commit_id': sha,
                        'body': '<!-- comail-dependency-policy:v2 -->'}
            for replacement in [{**matching, 'state': 'DISMISSED'},
                                {**matching, 'commit_id': 'b' * 40}]:
                with self.subTest(replacement=replacement):
                    self.assertFalse(approved([matching, replacement], sha))
            self.assertTrue(approved([matching, {**matching, 'state': 'DISMISSED'}, matching], sha))
        finally:
            sys.path.pop(0)


if __name__ == '__main__':
    unittest.main()
