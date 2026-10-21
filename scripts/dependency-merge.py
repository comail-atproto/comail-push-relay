#!/usr/bin/env python3
"""Merge the current tested head under a head-bound Dependabot policy approval."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

MARKER = '<!-- comail-dependency-policy:v2 -->'
DEPENDABOT = 49699333
ACTIONS = 41898282


def eligible(pr, repo, sha):
    return (pr['state'] == 'open' and not pr['draft'] and pr['commits'] == 1
            and pr['user']['id'] == DEPENDABOT and pr['head']['sha'] == sha
            and pr['head']['repo']['full_name'] == repo and pr['base']['ref'] == 'main'
            and pr['head']['ref'].startswith('dependabot/')
            and not pr['head']['ref'].startswith('dependabot/github_actions/')
            and not any(label['name'] == 'human' for label in pr['labels']))


def approved(reviews, sha):
    latest = {}
    for review in reviews:
        if review['state'] in ('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'):
            latest[review['user']['id']] = review['state']
    if 'CHANGES_REQUESTED' in latest.values():
        return False
    return any(review['user']['id'] == ACTIONS
               and review['user']['login'] == 'github-actions[bot]'
               and review['state'] == 'APPROVED' and review['commit_id'] == sha
               and review.get('body') == MARKER for review in reviews)


def authorize(repo, number, sha, api):
    path = f'repos/{repo}/pulls/{number}'
    pr = api(path)
    if not eligible(pr, repo, sha):
        return False
    commits = api(path + '/commits?per_page=100')
    if len(commits) != 1:
        return False
    commit = commits[0]
    message = commit['commit']['message']
    if (commit['sha'] != sha or (commit.get('author') or {}).get('id') != DEPENDABOT
            or not commit['commit']['verification']['verified']
            or not re.search(r'^Signed-off-by: .+ <[^>]+>$', message, re.M | re.I)):
        return False
    # Re-read mutable PR state after checking immutable commit provenance.
    if (not eligible(api(path), repo, sha)
            or not approved(api(path + '/reviews?per_page=100'), sha)):
        return False
    return message


def merge(repo, number, sha, api):
    message = authorize(repo, number, sha, api)
    if not message:
        return False
    path = f'repos/{repo}/pulls/{number}'
    # GitHub atomically enforces the expected SHA, required checks and reviews.
    # No native auto-merge request remains if checks are pending or the head moves.
    result = api(path + '/merge', 'PUT', {
        'sha': sha, 'merge_method': 'squash',
        'commit_title': message.splitlines()[0],
        'commit_message': '\n'.join(message.splitlines()[1:]).strip(),
    })
    return bool(result and result.get('merged'))


def github_api(path, method='GET', data=None):
    command = ['gh', 'api', '--method', method, path]
    paginated = method == 'GET' and '/reviews?' in path
    if paginated:
        command += ['--paginate', '--slurp']
    if data is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=json.dumps(data) if data is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        if method == 'PUT' and re.search(r'HTTP (405|409)\b', result.stderr):
            print('Merge deferred: required checks/reviews are pending or the head changed.')
            return None
        raise RuntimeError(result.stderr)
    value = json.loads(result.stdout)
    return [review for page in value for review in page] if paginated else value


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
        candidates = github_api(f'repos/{repo}/commits/{sha}/pulls?per_page=100')
    ready = False
    for candidate in candidates:
        if '--check' in sys.argv:
            ready = bool(authorize(repo, candidate['number'], sha, github_api)) or ready
        elif merge(repo, candidate['number'], sha, github_api):
            print(f'Merged tested dependency PR #{candidate["number"]} at {sha}.')
    if '--check' in sys.argv:
        with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
            output.write(f'ready={str(ready).lower()}\n')


if __name__ == '__main__':
    main()
