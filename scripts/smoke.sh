#!/usr/bin/env bash
set -euo pipefail
node dist/server.js &
PID=$!
trap "kill $PID 2>/dev/null || true" EXIT
sleep 2
curl -f http://127.0.0.1:5184/health
echo "Smoke test passed"
