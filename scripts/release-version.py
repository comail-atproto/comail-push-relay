"""Choose the next release version from Conventional Commit messages."""
import re
import subprocess


TAG = re.compile(r'^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')
COMMIT = re.compile(r'^[a-z]+(?:\([^)]+\))?(?P<breaking>!)?: .+')


def next_version(current_tag, messages):
    match = TAG.fullmatch(current_tag)
    if not match:
        raise ValueError(f'Invalid release tag: {current_tag}')
    major, minor, patch = map(int, match.groups())
    bump = 0
    for message in messages:
        header = message.splitlines()[0] if message.splitlines() else ''
        commit = COMMIT.fullmatch(header)
        if (commit and commit.group('breaking')) or re.search(r'^BREAKING CHANGE:', message, re.M):
            bump = max(bump, 3)
        elif commit:
            kind = header.split(':', 1)[0].split('(', 1)[0]
            bump = max(bump, {'feat': 2, 'fix': 1, 'perf': 1}.get(kind, 0))
    if bump == 3:
        return f'v{major}.{minor + 1}.0' if major == 0 else f'v{major + 1}.0.0'
    if bump == 2:
        return f'v{major}.{minor + 1}.0'
    if bump == 1:
        return f'v{major}.{minor}.{patch + 1}'
    return None


def main():
    tags = subprocess.check_output(
        ['git', 'tag', '--merged', 'HEAD', '--list', 'v[0-9]*'], text=True
    ).splitlines()
    versions = [(tuple(map(int, TAG.fullmatch(tag).groups())), tag)
                for tag in tags if TAG.fullmatch(tag)]
    if not versions:
        raise SystemExit('No vX.Y.Z release tag found')
    _, latest_tag = max(versions)
    log = subprocess.check_output(
        ['git', 'log', '--format=%s%n%b%x00', f'{latest_tag}..HEAD'], text=True
    )
    version = next_version(latest_tag, [message for message in log.split('\0') if message.strip()])
    if version:
        print(version)


if __name__ == '__main__':
    main()
