#!/usr/bin/env bash
set -euo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/comail-policy-0.1.0.pyz" stack-policy "$@"
