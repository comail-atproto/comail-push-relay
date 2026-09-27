#!/usr/bin/env python3
"""Keep temporary review evidence out of Git without banning product assets."""
from pathlib import PurePosixPath
import re
import subprocess
import sys

EVIDENCE_DIRS = {'pr-media', 'review-evidence', 'pr-evidence'}
CAPTURE_NAME = re.compile(r'^(?:before|after|screenshot|screen-shot)(?:[._ -].*)?\.(?:png|jpe?g|gif|webp|avif|svg|mp4|webm|mov)$', re.I)


def forbidden(path):
    parts = PurePosixPath(path).parts
    return bool(EVIDENCE_DIRS.intersection(parts) or CAPTURE_NAME.fullmatch(parts[-1]))


def main(args):
    if args == ['--staged']:
        comparison = ['--cached']
    elif len(args) == 2:
        comparison = []
        for ref in args:
            result = subprocess.run(['git', 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], capture_output=True, text=True)
            if result.returncode:
                print('Cannot resolve review media comparison.', file=sys.stderr)
                return 2
            comparison.append(result.stdout.strip())
    else:
        print('Usage: check-review-media.py <base> <head> | --staged', file=sys.stderr)
        return 2
    result = subprocess.run(['git', 'diff', *comparison, '--no-renames', '--name-only', '-z', '--'], capture_output=True)
    if result.returncode:
        print('Cannot read review media diff.', file=sys.stderr)
        return 2
    paths = result.stdout.decode('utf-8', errors='surrogateescape').split('\0')
    blocked = [path for path in paths if path and forbidden(path)]
    if blocked:
        print('Use native GitHub attachments for PR evidence. Historical evidence paths are frozen:', file=sys.stderr)
        for path in blocked:
            print(repr(path), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
