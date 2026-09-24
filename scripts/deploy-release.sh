#!/usr/bin/env bash
set -euo pipefail

mode="${1:?install, seed, or rollback}"
target=production
[[ "$mode" == install || "$mode" == seed || "$mode" == rollback ]]
test -n "${DEPLOY_KEY:-}" && test -n "${KNOWN_HOSTS:-}" && test -n "${DEPLOY_HOST:-}" && test -n "${DEPLOY_ORIGIN:-}"
private_dir="$RUNNER_TEMP/comail-push-ssh-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
install -m 700 -d "$private_dir"
trap 'rm -r "$private_dir"' EXIT
printf '%s\n' "$DEPLOY_KEY" > "$private_dir/key"
printf '%s\n' "$KNOWN_HOSTS" > "$private_dir/known_hosts"
chmod 600 "$private_dir/key" "$private_dir/known_hosts"
ssh_base=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -o UserKnownHostsFile="$private_dir/known_hosts" -i "$private_dir/key")
remote="comail-push-relay-deploy@$DEPLOY_HOST"

if [[ "$mode" == install || "$mode" == seed ]]; then
  sha256sum -c release.sha256
  source_sha=$(tar -xOzf release.tar.gz release.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source_sha))')
  [[ "$source_sha" =~ ^[0-9a-f]{40}$ ]]
  if [[ "$GITHUB_EVENT_NAME" == push ]]; then test "$source_sha" = "$GITHUB_SHA"; fi
  if [[ "$GITHUB_EVENT_NAME" == workflow_dispatch ]]; then test "$source_sha" = "$PROMOTED_SOURCE_SHA"; fi
  digest=$(cut -d' ' -f1 release.sha256)
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]]
  identity="$source_sha-${digest:0:16}"
  "${ssh_base[@]}" "$remote" "install $source_sha $digest $target" < release.tar.gz
  if [[ "$mode" == seed ]]; then
    activation=$("${ssh_base[@]}" "$remote" "seed $identity $GITHUB_RUN_NUMBER")
  else
    activation=$("${ssh_base[@]}" "$remote" "activate $identity $GITHUB_RUN_NUMBER")
  fi
else
  identity="${RELEASE_IDENTITY:?release identity}"
  [[ "$identity" =~ ^[0-9a-f]{40}-[0-9a-f]{16}$ ]]
  activation=$("${ssh_base[@]}" "$remote" "rollback $identity $GITHUB_RUN_NUMBER")
fi
previous=$(printf '%s' "$activation" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).previous || ""))')
write_receipt() {
  receipt_status=$("${ssh_base[@]}" "$remote" status)
  RELEASE_STATUS="$receipt_status" RELEASE_IDENTITY="$identity" RELEASE_APP=push-relay \
    DEPLOY_TARGET=production RELEASE_OPERATION="$mode" RELEASE_PREVIOUS="$previous" RELEASE_VERIFIED="$1" \
    node scripts/write-release-receipt.mjs
}
write_receipt false
if [[ "$mode" == seed ]]; then
  printf '%s\n' "$receipt_status"
  exit 0
fi
if ! "${ssh_base[@]}" "$remote" "restart $identity $GITHUB_RUN_NUMBER" ||
   ! bash scripts/check-release-health.sh "$identity" "$DEPLOY_ORIGIN"; then
  if test -n "$previous"; then
    "${ssh_base[@]}" "$remote" "restore $identity $previous $GITHUB_RUN_NUMBER"
    "${ssh_base[@]}" "$remote" "restart $previous $GITHUB_RUN_NUMBER"
    bash scripts/check-release-health.sh "$previous" "$DEPLOY_ORIGIN" || true
  fi
  exit 1
fi
write_receipt true
printf '%s\n' "$receipt_status"
