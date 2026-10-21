import importlib.util
import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SHA = 'a' * 40
REPO = 'comail-atproto/example'


class WorkflowTests(unittest.TestCase):
    def test_no_persistent_native_merge_permission(self):
        workflow = (ROOT / '.github/workflows/dependency-automerge.yml').read_text()
        self.assertNotIn('--auto', workflow)
        self.assertNotIn('enablePullRequestAutoMerge', workflow)


class MergeTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('merge', ROOT / 'scripts/dependency-merge.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.pr = {'number': 7, 'state': 'open', 'draft': False, 'commits': 1,
                   'user': {'id': 49699333}, 'labels': [],
                   'head': {'sha': SHA, 'ref': 'dependabot/npm_and_yarn/group',
                            'repo': {'full_name': REPO}}, 'base': {'ref': 'main'}}
        self.commit = {'sha': SHA, 'author': {'id': 49699333},
                       'commit': {'verification': {'verified': True},
                                  'message': 'chore(deps): Update packages\n\nSigned-off-by: dependabot[bot] <support@github.com>'}}
        self.review = {'user': {'id': 41898282, 'login': 'github-actions[bot]'},
                       'state': 'APPROVED', 'commit_id': SHA,
                       'body': '<!-- comail-dependency-policy:v2 -->'}
        self.merged = []
        self.reads = 0

    def api(self, path, method='GET', data=None):
        if method == 'PUT':
            self.merged.append(data)
            return {'merged': True}
        if '/commits?' in path:
            return [self.commit]
        if '/reviews?' in path:
            return [self.review]
        self.reads += 1
        return self.pr

    def run_merge(self):
        return self.module.merge(REPO, 7, SHA, self.api)

    def test_preflight_never_requests_a_merge(self):
        self.assertTrue(self.module.authorize(REPO, 7, SHA, self.api))
        self.assertEqual(self.merged, [])

    def test_merge_uses_exact_head_without_queueing(self):
        self.assertTrue(self.run_merge())
        self.assertEqual(self.merged[0]['sha'], SHA)
        self.assertEqual(self.merged[0]['merge_method'], 'squash')

    def test_extra_writer_commit_cannot_inherit_approval(self):
        self.pr['commits'] = 2
        self.assertFalse(self.run_merge())
        self.assertEqual(self.merged, [])

    def test_replaced_head_cannot_inherit_approval(self):
        self.pr['head']['sha'] = 'b' * 40
        self.assertFalse(self.run_merge())

    def test_old_head_review_cannot_authorize_major_upgrade(self):
        self.review['commit_id'] = 'b' * 40
        self.assertFalse(self.run_merge())

    def test_missing_policy_marker_fails_closed(self):
        self.review['body'] = ''
        self.assertFalse(self.run_merge())

    def test_dismissed_review_fails_closed(self):
        self.review['state'] = 'DISMISSED'
        self.assertFalse(self.run_merge())

    def test_human_requested_changes_stops_automatic_merge(self):
        reviews = [self.review, {'user': {'id': 1456022}, 'state': 'REQUEST_CHANGES'}]
        self.assertFalse(self.module.approved(reviews, SHA))
        reviews.append({'user': {'id': 1456022}, 'state': 'APPROVED', 'commit_id': SHA})
        self.assertTrue(self.module.approved(reviews, SHA))

    def test_spoofed_approval_fails_closed(self):
        self.review['user']['id'] = 123
        self.assertFalse(self.run_merge())

    def test_unsigned_commit_fails_closed(self):
        self.commit['commit']['verification']['verified'] = False
        self.assertFalse(self.run_merge())

    def test_writer_replacement_commit_fails_closed(self):
        self.commit['author']['id'] = 123
        self.assertFalse(self.run_merge())

    def test_missing_dco_fails_closed(self):
        self.commit['commit']['message'] = 'chore(deps): Update'
        self.assertFalse(self.run_merge())

    def test_manual_hold_draft_fork_and_changed_base_fail_closed(self):
        original = json.loads(json.dumps(self.pr))
        mutations = [lambda p: p.update(draft=True),
                     lambda p: p.update(labels=[{'name': 'human'}]),
                     lambda p: p['base'].update(ref='dev'),
                     lambda p: p['head']['repo'].update(full_name='external/fork'),
                     lambda p: p['head'].update(ref='dependabot/github_actions/setup-node-7'),
                     lambda p: p.update(state='closed')]
        for mutation in mutations:
            self.pr = json.loads(json.dumps(original))
            mutation(self.pr)
            self.assertFalse(self.run_merge())
        self.assertEqual(self.merged, [])

    def test_head_changed_while_checking_review_is_not_merged(self):
        original = self.api
        def moving(path, method='GET', data=None):
            if path.endswith('/pulls/7') and self.reads:
                self.pr['head']['sha'] = 'b' * 40
            return original(path, method, data)
        self.assertFalse(self.module.merge(REPO, 7, SHA, moving))
        self.assertEqual(self.merged, [])

    def test_untrusted_or_failed_workflow_cannot_trigger_merge(self):
        events = [
            {'event': 'pull_request', 'conclusion': 'success',
             'head_repository': {'full_name': 'external/fork'}},
            {'event': 'pull_request', 'conclusion': 'failure',
             'head_repository': {'full_name': REPO}},
            {'event': 'workflow_run', 'conclusion': 'success',
             'head_repository': {'full_name': REPO}},
        ]
        for run in events:
            with tempfile.NamedTemporaryFile(mode='w') as event:
                json.dump({'workflow_run': run}, event)
                event.flush()
                api = Mock()
                with patch.dict(os.environ, {'GITHUB_REPOSITORY': REPO,
                                'GITHUB_EVENT_NAME': 'workflow_run',
                                'GITHUB_EVENT_PATH': event.name}), patch.object(self.module, 'github_api', api):
                    self.module.main()
                api.assert_not_called()

    def test_missing_commit_author_fails_closed(self):
        self.commit['author'] = None
        self.assertFalse(self.run_merge())

    def test_pending_checks_or_head_race_leave_no_queued_request(self):
        original = self.api
        def deferred(path, method='GET', data=None):
            return None if method == 'PUT' else original(path, method, data)
        self.assertFalse(self.module.merge(REPO, 7, SHA, deferred))
        self.assertEqual(self.merged, [])


if __name__ == '__main__':
    unittest.main()
