#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
event="$(mktemp)"
trap 'rm -f "$event"' EXIT
printf '%s\n' '{"repository":{"full_name":"comail-atproto/example","default_branch":"main"},"pull_request":{"number":1,"base":{"ref":"main","repo":{"full_name":"comail-atproto/example"}},"head":{"repo":{"full_name":"comail-atproto/example"}}}}' > "$event"
GITHUB_EVENT_PATH="$event" GITHUB_REPOSITORY=comail-atproto/example bash "$repo_root/scripts/check-pr-stack-policy.sh"
printf '%s\n' '{}' > "$event"
if GITHUB_EVENT_PATH="$event" GITHUB_REPOSITORY=comail-atproto/example bash "$repo_root/scripts/check-pr-stack-policy.sh"; then
  echo 'stack policy accepted malformed input' >&2
  exit 1
fi
