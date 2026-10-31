#!/usr/bin/env bash
set -euo pipefail

mode="${1:?install, seed, rollback, or observe}"
target=production
[[ "$mode" == install || "$mode" == seed || "$mode" == rollback || "$mode" == observe || "$mode" == verify ]]
test -n "${DEPLOY_KEY:-}" && test -n "${KNOWN_HOSTS:-}" && test -n "${DEPLOY_HOST:-}" && test -n "${DEPLOY_ORIGIN:-}"
private_dir="$RUNNER_TEMP/comail-push-ssh-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
install -m 700 -d "$private_dir"
trap 'rm -r "$private_dir"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$private_dir/key"
printf '%s\n' "$KNOWN_HOSTS" > "$private_dir/known_hosts"
chmod 600 "$private_dir/key" "$private_dir/known_hosts"
ssh_base=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$private_dir/known_hosts" -i "$private_dir/key")
remote="$DEPLOY_HOST"

run_ssh() {
  local status
  timeout 120s "${ssh_base[@]}" "$remote" "$@" 2>/dev/null || {
    status=$?
    echo 'Deployment request failed' >&2
    return "$status"
  }
}

# Bound status reporting so monitoring cannot stall deployment checks or cleanup.
run_observation_ssh() {
  node --input-type=module -e '
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.argv[1], process.argv.slice(2), {
  timeout: 10000, maxBuffer: 16384,
  input: process.argv.at(-1) === "report" ? readFileSync(0) : "",
});
if (result.error) process.exit(1);
process.stdout.write(result.stdout);
process.exit(result.status ?? 1);
' "${ssh_base[@]}" -o ConnectTimeout=5 -o ConnectionAttempts=1 "$remote" "$1"
}

report_observation() {
  local status="${receipt_status:-}" payload
  if [[ "$mode" == observe || "$mode" == accept ]]; then
    if ! status=$(run_observation_ssh status 2>/dev/null); then
      echo 'Deployment status reporting unavailable' >&2
      return 0
    fi
  elif [[ -z "$status" ]]; then
    return 0
  fi
  if ! payload=$(RELEASE_STATUS="$status" RELEASE_OBSERVATION_STAGE="$1" \
      RELEASE_OBSERVATION_RESULT="$2" RELEASE_OBSERVATION_SECONDS="$3" \
      node --input-type=module 2>/dev/null <<'JS'
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const status = JSON.parse(process.env.RELEASE_STATUS);
if (status.observation_version !== 1) process.exit(0);
const path = join(process.env.RUNNER_TEMP, "comail-release-receipt.json");
if (statSync(path).size > 16384) throw new Error("receipt too large");
const receipt = JSON.parse(readFileSync(path, "utf8"));
const sequence = receipt.activation_sequence ?? receipt.workflow_run_number;
if (!Number.isInteger(sequence) || sequence !== status.state.sequence || status.state.phase !== "complete" ||
    status.state.release !== receipt.release_identity || status.active !== receipt.release_identity ||
    status.archive_sha256 !== receipt.archive_sha256 || status.app !== receipt.app ||
    status.environment !== receipt.environment || (status.role ?? status.app) !== (receipt.role ?? receipt.app)) {
  throw new Error("receipt no longer matches selection");
}
const allowed = new Set([
  "app", "environment", "role", "operation",
  "release_identity", "source_sha", "archive_sha256", "previous",
  "workflow_run_id", "source_run_id", "workflow_run_number", "workflow_run_attempt",
  "activation_sequence", "serving_verified", "selection_verified", "acceptance",
  "recovery", "recovery_drill",
]);
console.log(JSON.stringify({receipt: Object.fromEntries(Object.entries(receipt).filter(([key]) => allowed.has(key))),
  stage: process.env.RELEASE_OBSERVATION_STAGE, result: process.env.RELEASE_OBSERVATION_RESULT,
  observation_seconds: Number(process.env.RELEASE_OBSERVATION_SECONDS)}));
JS
  ); then
    echo 'Deployment status reporting unavailable' >&2
    return 0
  fi
  if [[ -n "$payload" ]] && ! run_observation_ssh report <<< "$payload" >/dev/null 2>&1; then
    echo 'Deployment status reporting unavailable' >&2
  fi
  return 0
}

finish_release() {
  local result=$?
  trap - EXIT
  if [[ "$mode" != observe && "$mode" != verify && "$mode" != stage && -s "$RUNNER_TEMP/comail-release-receipt.json" ]]; then
    local outcome=success
    if (( result != 0 )); then outcome=failure; fi
    report_observation complete "$outcome" 0
  fi
  rm -r "$private_dir"
  return "$result"
}
trap finish_release EXIT

if [[ "$mode" == verify ]]; then
  run_ssh status >/dev/null
  exit 0
fi

if [[ "$mode" == observe ]]; then
  report_observation "${RELEASE_OBSERVATION_STAGE:-complete}" "${RELEASE_OBSERVATION_RESULT:-success}" "${RELEASE_OBSERVATION_SECONDS:-0}"
  exit 0
fi

if [[ "$mode" == install || "$mode" == seed ]]; then
  sha256sum -c release.sha256
  source_sha=$(tar -xOzf release.tar.gz release.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source_sha))')
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
  if [[ "$GITHUB_EVENT_NAME" == push ]]; then test "$source_sha" = "$GITHUB_SHA"; fi
  if [[ "$GITHUB_EVENT_NAME" == workflow_dispatch ]]; then test "$source_sha" = "$PROMOTED_SOURCE_SHA"; fi
  digest=$(cut -d' ' -f1 release.sha256)
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]]
  identity="$source_sha-${digest:0:16}"
  run_ssh "install $source_sha $digest $target" < release.tar.gz >/dev/null
  if [[ "$mode" == seed ]]; then
    activation=$(run_ssh "seed $identity $GITHUB_RUN_NUMBER")
  else
    activation=$(run_ssh "activate $identity $GITHUB_RUN_NUMBER")
  fi
else
  identity="${RELEASE_IDENTITY:?release identity}"
  [[ "$identity" =~ ^[0-9a-f]{40}-[0-9a-f]{16}$ ]]
  activation=$(run_ssh "rollback $identity $GITHUB_RUN_NUMBER")
fi
if ! previous=$(printf '%s' "$activation" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).previous || ""))' 2>/dev/null); then
  echo 'Invalid deployment response' >&2
  exit 1
fi
write_receipt() {
  receipt_status=$(run_ssh status)
  RELEASE_STATUS="$receipt_status" RELEASE_IDENTITY="$identity" RELEASE_APP=push-relay \
    DEPLOY_TARGET=production RELEASE_OPERATION="$mode" RELEASE_PREVIOUS="$previous" RELEASE_VERIFIED="$1" \
    node scripts/write-release-receipt.mjs >/dev/null 2>&1 || { echo 'Invalid deployment status' >&2; return 1; }
}
write_receipt false
if [[ "$mode" == seed ]]; then
  exit 0
fi
if ! run_ssh "restart $identity $GITHUB_RUN_NUMBER" >/dev/null ||
   ! bash scripts/check-release-health.sh "$identity" "$DEPLOY_ORIGIN" >/dev/null 2>&1; then
  echo 'Deployment health check failed' >&2
  if test -n "$previous"; then
    run_ssh "restore $identity $previous $GITHUB_RUN_NUMBER" >/dev/null
    run_ssh "restart $previous $GITHUB_RUN_NUMBER" >/dev/null
    bash scripts/check-release-health.sh "$previous" "$DEPLOY_ORIGIN" >/dev/null 2>&1 || true
  fi
  exit 1
fi
write_receipt true
