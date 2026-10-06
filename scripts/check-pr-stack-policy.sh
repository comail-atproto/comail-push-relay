#!/usr/bin/env bash
set -euo pipefail
umask 077

event_path="${GITHUB_EVENT_PATH:-}"
if [[ -z "$event_path" || ! -f "$event_path" || -L "$event_path" ]]; then
  echo "pull request stack policy requires a regular GitHub event file" >&2
  exit 1
fi

if ! jq -e '.pull_request | type == "object"' "$event_path" >/dev/null; then
  echo "pull request stack policy requires a pull_request event" >&2
  exit 1
fi

repo="$(jq -er '.repository.full_name | select(type == "string" and length > 0)' "$event_path")"
default_branch="$(jq -er '.repository.default_branch | select(type == "string" and length > 0)' "$event_path")"
number="$(jq -er '.pull_request.number | select(type == "number" and . > 0)' "$event_path")"
base_ref="$(jq -er '.pull_request.base.ref | select(type == "string" and length > 0)' "$event_path")"
base_repo="$(jq -er '.pull_request.base.repo.full_name | select(type == "string" and length > 0)' "$event_path")"
head_repo="$(jq -er '.pull_request.head.repo.full_name | select(type == "string" and length > 0)' "$event_path")"

if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ || "$repo" != "$base_repo" || "${GITHUB_REPOSITORY:-$repo}" != "$repo" ]]; then
  echo "pull request stack policy received inconsistent repository identity" >&2
  exit 1
fi

if [[ "$base_ref" == "$default_branch" ]]; then
  echo "ok: pull request #$number targets trunk $default_branch"
  exit 0
fi

# GitHub cannot put fork pull requests into a first-class stack. Preserve the
# ordinary fork review path even when a contributor deliberately targets a
# non-default branch.
if [[ "$head_repo" != "$base_repo" ]]; then
  echo "ok: pull request #$number is a cross-repository fork"
  exit 0
fi

stack_filter='type == "object" and
  (.number | type == "number") and .number > 0 and .number == (.number | floor) and
  (.position | type == "number") and .position > 0 and .position == (.position | floor) and
  (.size | type == "number") and .size >= .position and .size == (.size | floor) and
  (.base.ref | type == "string" and length > 0)'
if jq -e ".pull_request.stack | $stack_filter" "$event_path" >/dev/null; then
  echo "ok: pull request #$number has first-class GitHub stack metadata"
  exit 0
fi

if [[ -n "${COMAIL_PR_STACK_OPEN_PULLS_JSON+x}" ]]; then
  open_pulls="$COMAIL_PR_STACK_OPEN_PULLS_JSON"
else
  github_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
  if [[ -z "$github_token" || "${#github_token}" -gt 16384 || "$github_token" == *$'\n'* || "$github_token" == *$'\r'* ]]; then
    echo "pull request stack policy requires a bounded GitHub token" >&2
    exit 1
  fi
  owner="${repo%%/*}"
  head_query="$(jq -rn --arg value "$owner:$base_ref" '$value | @uri')"
  open_pulls="$(curl --fail-with-body --silent --show-error --max-time 30 \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer $github_token" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/$repo/pulls?state=open&head=$head_query&per_page=100")"
fi

if ! jq -e 'type == "array"' <<< "$open_pulls" >/dev/null; then
  echo "pull request stack policy received malformed base-PR evidence" >&2
  exit 1
fi

if jq -e \
  --arg repo "$repo" \
  --arg base_ref "$base_ref" \
  --argjson number "$number" \
  'any(.[]; .number != $number and .head.repo.full_name == $repo and .head.ref == $base_ref)' \
  <<< "$open_pulls" >/dev/null; then
  # Stack conversion can happen after GitHub freezes the event payload. Accept
  # live metadata only for the same PR revision and base that this run checks.
  if [[ -n "${COMAIL_PR_STACK_CURRENT_PULL_JSON+x}" ]]; then
    current_pull="$COMAIL_PR_STACK_CURRENT_PULL_JSON"
  else
    github_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    if [[ -z "$github_token" || "${#github_token}" -gt 16384 || "$github_token" == *$'\n'* || "$github_token" == *$'\r'* ]]; then
      echo "pull request stack policy requires a bounded GitHub token" >&2
      exit 1
    fi
    current_pull="$(curl --fail --silent --show-error --max-time 30 \
      --header "Accept: application/vnd.github+json" \
      --header "Authorization: Bearer $github_token" \
      --header "X-GitHub-Api-Version: 2022-11-28" \
      "https://api.github.com/repos/$repo/pulls/$number")"
  fi
  head_sha="$(jq -er '.pull_request.head.sha | select(type == "string" and test("^[0-9a-f]{40}$"))' "$event_path")"
  if jq -e --arg repo "$repo" --arg base_ref "$base_ref" \
    --arg head_sha "$head_sha" --argjson number "$number" \
    'type == "object" and .number == $number and
     .head.repo.full_name == $repo and .head.sha == $head_sha and
     .base.repo.full_name == $repo and .base.ref == $base_ref and
     (.stack | type == "object") and
     (.stack.number | type == "number") and .stack.number > 0 and
     .stack.number == (.stack.number | floor) and
     (.stack.position | type == "number") and .stack.position > 0 and
     .stack.position == (.stack.position | floor) and
     (.stack.size | type == "number") and .stack.size >= .stack.position and
     .stack.size == (.stack.size | floor) and
     (.stack.base.ref | type == "string" and length > 0)' \
    <<< "$current_pull" >/dev/null; then
    echo "ok: pull request #$number has live first-class stack metadata for this revision"
    exit 0
  fi
  echo "pull request #$number targets open PR branch $base_ref without first-class stack metadata" >&2
  echo "link the ordered PRs with: gh stack link <bottom-pr> ... <$number>" >&2
  exit 1
fi

echo "ok: pull request #$number targets custom trunk $base_ref"
