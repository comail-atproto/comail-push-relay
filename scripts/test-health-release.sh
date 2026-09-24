#!/usr/bin/env bash
set -euo pipefail

temp_dir=$(mktemp -d)
port=$((20000 + RANDOM))
identity=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb
(sleep 0.5; HOST=127.0.0.1 PORT="$port" PUSH_DATA_DIR="$temp_dir" COMAIL_RELEASE_IDENTITY="$identity" \
  exec node dist/server.js) > "$temp_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; rm -r "$temp_dir"' EXIT
COMAIL_HEALTH_PATH=/api/health COMAIL_HEALTH_ATTEMPTS=20 COMAIL_HEALTH_DELAY=0.1 bash scripts/check-release-health.sh "$identity" "http://127.0.0.1:$port"
if COMAIL_HEALTH_PATH=/api/health COMAIL_HEALTH_ATTEMPTS=2 COMAIL_HEALTH_DELAY=0.1 bash scripts/check-release-health.sh \
  cccccccccccccccccccccccccccccccccccccccc-dddddddddddddddd "http://127.0.0.1:$port"; then
  echo 'health check accepted a persistent wrong identity' >&2
  exit 1
fi
for _ in $(seq 1 30); do
  if curl --silent --fail "http://127.0.0.1:$port/api/health" > "$temp_dir/health.json"; then
    break
  fi
  sleep 0.2
done
EXPECTED_IDENTITY="$identity" node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(r.ok!==true||r.release_identity!==process.env.EXPECTED_IDENTITY)process.exit(1)' "$temp_dir/health.json"
