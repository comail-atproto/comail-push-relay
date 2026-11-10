#!/usr/bin/env python3
"""Use reviewed PR titles with the bundled dependency authorization policy."""

import importlib
import json
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).with_name("comail-policy-0.1.0.pyz")))
policy = importlib.import_module('comail_policy.dependency_merge')


def merge(repo, number, sha, api):
    # The immutable bundle validates the head and approval but uses the old
    # commit subject. Keep its policy and adapt only the final merge title.
    pr_path = f'repos/{repo}/pulls/{number}'
    title = None

    def current_title_api(path, method='GET', data=None):
        nonlocal title
        if method == 'PUT' and path == pr_path + '/merge':
            if not isinstance(title, str) or not title:
                raise ValueError('Current pull request title is missing')
            data = {**data, 'commit_title': title}
        result = api(path, method, data)
        if method == 'GET' and path == pr_path:
            title = result.get('title')
        return result

    return policy.merge(repo, number, sha, current_title_api)


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'comail-atproto/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Unexpected repository')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    if os.environ['GITHUB_EVENT_NAME'] == 'pull_request_target':
        sha = event['pull_request']['head']['sha']
        candidates = [event['pull_request']]
    else:
        run = event['workflow_run']
        if (run['event'] != 'pull_request' or run['conclusion'] != 'success'
                or run['head_repository']['full_name'] != repo):
            return
        sha = run['head_sha']
        if not re.fullmatch(r'[a-f0-9]{40}', sha):
            raise ValueError('Invalid source head')
        candidates = policy.github_api(f'repos/{repo}/commits/{sha}/pulls?per_page=100')
    ready = False
    for candidate in candidates:
        if '--check' in sys.argv:
            ready = bool(policy.authorize(repo, candidate['number'], sha, policy.github_api)) or ready
        elif merge(repo, candidate['number'], sha, policy.github_api):
            print(f'Merged tested dependency PR #{candidate["number"]} at {sha}.')
    if '--check' in sys.argv:
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'ready={str(ready).lower()}\n')


if __name__ == '__main__':
    main()
