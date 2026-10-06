#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
run_root="$(mktemp -d "${TMPDIR:-/tmp}/comail-pr-stack-policy.XXXXXXXX")"

cleanup() {
  case "$run_root" in
    "${TMPDIR:-/tmp}"/comail-pr-stack-policy.*) rm -rf -- "$run_root" ;;
    *) return 1 ;;
  esac
}
trap cleanup EXIT

run_case() {
  local name="$1"
  local want="$2"
  local base_ref="$3"
  local head_repo="$4"
  local stack_json="$5"
  local open_pulls_json="$6"
  local current_pull_json="${7:-null}"
  local event_path="$run_root/$name.json"
  local output_path="$run_root/$name.out"

  jq -n \
    --arg base_ref "$base_ref" \
    --arg head_repo "$head_repo" \
    --argjson stack "$stack_json" \
    '{
      repository: {default_branch: "main", full_name: "comail-atproto/atmosphere-mail"},
      pull_request: {
        number: 20,
        base: {ref: $base_ref, repo: {full_name: "comail-atproto/atmosphere-mail"}},
        head: {sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ref: "feature-child", repo: {full_name: $head_repo}},
        stack: $stack
      }
    }' > "$event_path"

  local status=0
  GITHUB_EVENT_PATH="$event_path" \
    GITHUB_REPOSITORY="comail-atproto/atmosphere-mail" \
    COMAIL_PR_STACK_OPEN_PULLS_JSON="$open_pulls_json" \
    COMAIL_PR_STACK_CURRENT_PULL_JSON="$current_pull_json" \
    bash "$repo_root/scripts/check-pr-stack-policy.sh" > "$output_path" 2>&1 || status=$?

  if [[ "$want" == "pass" && "$status" -ne 0 ]]; then
    echo "$name: expected pass" >&2
    sed -n '1,120p' "$output_path" >&2
    return 1
  fi
  if [[ "$want" == "fail" && "$status" -eq 0 ]]; then
    echo "$name: expected failure" >&2
    return 1
  fi
}

open_parent='[{"number":19,"head":{"ref":"feature-parent","repo":{"full_name":"comail-atproto/atmosphere-mail"}}}]'

run_case default-trunk pass main comail-atproto/atmosphere-mail null "$open_parent"
run_case first-class-stack pass feature-parent comail-atproto/atmosphere-mail '{"id":7,"number":8,"position":2,"size":2,"base":{"ref":"main"}}' "$open_parent"
run_case empty-stack fail feature-parent comail-atproto/atmosphere-mail '{}' "$open_parent"
run_case impossible-position fail feature-parent comail-atproto/atmosphere-mail '{"id":7,"number":8,"position":3,"size":2,"base":{"ref":"main"}}' "$open_parent"
run_case missing-trunk fail feature-parent comail-atproto/atmosphere-mail '{"id":7,"number":8,"position":2,"size":2}' "$open_parent"
run_case custom-trunk pass release-branch comail-atproto/atmosphere-mail null '[]'
run_case fork-pr pass feature-parent contributor/atmosphere-mail null "$open_parent"
run_case unlinked-dependent fail feature-parent comail-atproto/atmosphere-mail null "$open_parent"
run_case malformed-evidence fail feature-parent comail-atproto/atmosphere-mail null '{}'

current_pull='{"number":20,"head":{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","repo":{"full_name":"comail-atproto/atmosphere-mail"}},"base":{"ref":"feature-parent","repo":{"full_name":"comail-atproto/atmosphere-mail"}},"stack":{"id":7,"number":8,"position":2,"size":2,"base":{"ref":"main"}}}'
run_case linked-after-event pass feature-parent comail-atproto/atmosphere-mail null "$open_parent" "$current_pull"
run_case newer-head fail feature-parent comail-atproto/atmosphere-mail null "$open_parent" "${current_pull/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
run_case different-base fail feature-parent comail-atproto/atmosphere-mail null "$open_parent" "${current_pull/feature-parent/other-parent}"
run_case different-number fail feature-parent comail-atproto/atmosphere-mail null "$open_parent" "${current_pull/\"number\":20/\"number\":21}"
run_case malformed-live fail feature-parent comail-atproto/atmosphere-mail null "$open_parent" '[]'

if ! grep -q 'gh stack link' "$run_root/unlinked-dependent.out"; then
  echo "unlinked-dependent: remediation did not name gh stack link" >&2
  exit 1
fi

if ! grep -q 'malformed base-PR evidence' "$run_root/malformed-evidence.out"; then
  echo "malformed-evidence: policy did not fail closed on malformed API evidence" >&2
  exit 1
fi

echo "ok: first-class pull request stack policy"
