#!/usr/bin/env python3
"""Only a verified current main commit with a parent may deploy automatically."""
import json
import os
import re
import subprocess


def eligible(commit, sha):
    return (bool(re.fullmatch(r"[a-f0-9]{40}", sha)) and commit.get("sha") == sha
            and bool(commit.get("parents"))
            and commit.get("commit", {}).get("verification", {}).get("verified") is True)


def main():
    commit = json.loads(subprocess.check_output(["gh", "api", f"repos/{os.environ['GITHUB_REPOSITORY']}/commits/main"]))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"deploy={'true' if eligible(commit, os.environ['GITHUB_SHA']) else 'false'}\n")


if __name__ == "__main__":
    main()
