#!/usr/bin/env bash
set -euo pipefail
identity="${1:?release identity}"
origin="${2:?health origin}"
health_path="${COMAIL_HEALTH_PATH:-/push-relay/api/health}"
attempts="${COMAIL_HEALTH_ATTEMPTS:-30}"
delay="${COMAIL_HEALTH_DELAY:-0.5}"
[[ "$attempts" =~ ^[1-9][0-9]*$ && "$health_path" == /* ]]
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if body=$(curl --fail --silent --max-time 2 --max-filesize 4096 "$origin$health_path") &&
    BODY="$body" EXPECTED_IDENTITY="$identity" node -e '
      const value = JSON.parse(process.env.BODY);
      if (value.ok !== true || value.release_identity !== process.env.EXPECTED_IDENTITY) process.exit(1);
    '; then
    exit 0
  fi
  if ((attempt < attempts)); then sleep "$delay"; fi
done
echo "push relay did not serve release $identity at $origin$health_path" >&2
exit 1
