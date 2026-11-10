"""Keep repository merge wiring separate from the shared policy matrix."""
from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest
import sys
from unittest.mock import Mock, patch

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


class EntryPointMergeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('entrypoint', ROOT / 'scripts/dependency-merge.py')
        entrypoint = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(entrypoint)
        repo, sha = 'comail-atproto/example', 'a' * 40
        pr = dict(state='open', draft=False, commits=1, labels=[],
                  title='chore(deps): update the parser', user=dict(id=49699333),
                  head=dict(sha=sha, ref='dependabot/npm/parser', repo=dict(full_name=repo)),
                  base=dict(ref='main'))
        commit = dict(sha=sha, author=dict(id=49699333), commit=dict(
            verification=dict(verified=True), message='chore(deps): bump parser\n\nSigned-off-by: dependabot[bot] <support@github.com>'))
        review = dict(user=dict(id=41898282, login='github-actions[bot]'), state='APPROVED',
                      commit_id=sha, body='<!-- comail-dependency-policy:v2 -->')
        reads = 0
        def response(path, method='GET', data=None):
            nonlocal reads
            if method == 'PUT':
                return dict(merged=True)
            if '/commits?' in path:
                return [commit]
            if '/reviews?' in path:
                return [review]
            reads += 1
            return {**pr, 'title': 'security(deps): update the vulnerable parser'} if reads > 1 else pr
        self.api = Mock(side_effect=response)
        self.entrypoint, self.repo, self.sha = entrypoint, repo, sha

    def test_reviewed_title_replaces_original_subject_and_keeps_trailers(self):
        self.assertTrue(self.entrypoint.merge(self.repo, 7, self.sha, self.api))
        payload = self.api.call_args.args[2]
        self.assertEqual(payload['commit_title'], 'security(deps): update the vulnerable parser')
        self.assertEqual(payload['commit_message'], 'Signed-off-by: dependabot[bot] <support@github.com>')
        self.assertEqual(payload['sha'], self.sha)

    def test_check_reports_readiness_without_requesting_a_merge(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            output = Path(directory) / 'output'
            event.write_text(json.dumps({'pull_request': {'number': 7, 'head': {'sha': self.sha}}}))
            with patch.dict(os.environ, {
                'GITHUB_REPOSITORY': self.repo,
                'GITHUB_EVENT_NAME': 'pull_request_target',
                'GITHUB_EVENT_PATH': str(event),
                'GITHUB_OUTPUT': str(output),
            }), patch.object(self.entrypoint.policy, 'github_api', self.api), patch.object(
                sys, 'argv', ['dependency-merge.py', '--check']
            ):
                self.entrypoint.main()
            self.assertEqual(output.read_text(), 'ready=true\n')
        self.assertFalse(any(call.args[1] != 'GET' for call in self.api.call_args_list if len(call.args) > 1))


if __name__ == '__main__':
    unittest.main()
