#!/usr/bin/env bash
# Connect a hosted deployment job without printing private network diagnostics.
set -euo pipefail
network_dir="$RUNNER_TEMP/release-network"
socket="$network_dir/tailscaled.sock"
cleanup() {
  if [[ -x "$network_dir/tailscale" ]]; then
    timeout 15s sudo "$network_dir/tailscale" --socket="$socket" logout >/dev/null 2>&1 || true
  fi
  timeout 15s sudo systemctl stop push-release-network.service >/dev/null 2>&1 || true
}
case "${1:-}" in
  disconnect) cleanup ;;
  connect)
    test -n "${TAILSCALE_SECRET:-}" && test -n "${TAILSCALE_TAG:-}"
    mkdir -m 700 "$network_dir"
    if ! { curl -fsSL --retry 2 --max-time 60 https://pkgs.tailscale.com/stable/tailscale_1.104.2_amd64.tgz -o "$network_dir/tailscale.tgz" &&
      printf '%s  %s\n' '512f613ed7d04fc7282f7dc5bd76aa105aae28168fbb9357eb749ebcbc29f0ae' "$network_dir/tailscale.tgz" | sha256sum -c - &&
      tar -xzf "$network_dir/tailscale.tgz" --strip-components=1 -C "$network_dir" tailscale_1.104.2_amd64/tailscale tailscale_1.104.2_amd64/tailscaled; } >/dev/null 2>&1; then
      echo 'Network setup failed' >&2; exit 1
    fi
    if ! timeout 20s sudo systemd-run --unit=push-release-network --property=Type=exec \
      "$network_dir/tailscaled" --state=mem: --socket="$socket" >/dev/null 2>&1; then
      cleanup
      echo 'Network setup failed' >&2; exit 1
    fi
    for _ in {1..30}; do [[ -S "$socket" ]] && break; sleep 0.5; done
    if ! timeout 120s sudo "$network_dir/tailscale" --socket="$socket" up --hostname=github-release \
      --accept-dns=false --accept-routes=false --advertise-tags="$TAILSCALE_TAG" \
      --authkey="${TAILSCALE_SECRET}?preauthorized=true&ephemeral=true" >/dev/null 2>&1; then
      cleanup
      echo 'Network setup failed' >&2; exit 1
    fi
    ;;
  *) echo 'Expected connect or disconnect' >&2; exit 2 ;;
esac
