#!/usr/bin/env bash
# Start the learning playground at http://localhost:5199 (installs deps on first run).
set -euo pipefail

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")"

# Homebrew's node isn't always on PATH in non-login shells.
for p in /opt/homebrew/bin /usr/local/bin; do
  [[ -d "$p" && ":$PATH:" != *":$p:"* ]] && PATH="$p:$PATH"
done
export PATH

URL="http://localhost:5199"

# Already running (e.g. in another terminal)? Just open it instead of failing on the fixed port.
if curl -fsS --max-time 2 "$URL/" 2>/dev/null | grep -q "Learning Playground"; then
  echo "Learning Playground is already running at $URL — opening it."
  command -v open >/dev/null 2>&1 && open "$URL" || echo "Open $URL in your browser."
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js first: brew install node" >&2
  exit 1
fi

# First run, or package-lock.json changed since the last install (e.g. after a git pull).
if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "Installing dependencies…"
  npm install --no-fund --no-audit
fi

# npm start = scripts/start.mjs: runs Vite plus the GitHub auto-updater (checks every 30 min).

exec npm start
