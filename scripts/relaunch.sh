#!/usr/bin/env bash
# One-shot dev relaunch: kill anything running on the azimut ports, rebuild
# the frontend, and start a single backend process that serves the fresh
# build directly (no vite dev server, no proxy — just one process).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Killing any existing azimut / vite processes"
pkill -f ".venv/bin/azimut" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
for port in 8477 5173; do
  pid=$(lsof -ti:"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null || true
  fi
done
sleep 1

echo "==> Rebuilding frontend"
(cd frontend && npm run build)

echo "==> Starting azimut on http://127.0.0.1:8477"
exec .venv/bin/azimut
