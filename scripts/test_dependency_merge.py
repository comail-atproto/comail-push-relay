"""Keep repository merge wiring separate from the shared policy matrix."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    def test_no_persistent_native_merge_permission(self):
        workflow = (ROOT / '.github/workflows/dependency-automerge.yml').read_text()
        self.assertNotIn('--auto', workflow)
        self.assertNotIn('enablePullRequestAutoMerge', workflow)


if __name__ == '__main__':
    unittest.main()
