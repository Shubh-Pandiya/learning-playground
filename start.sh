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

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 20.19+ or 22.12+ (macOS: brew install node, or https://nodejs.org)." >&2
  exit 1
fi

# npm start = scripts/start.mjs: checks the Node version, installs dependencies (incl. dev)
# when Vite is missing or package-lock.json changed, then runs Vite plus the GitHub
# auto-updater (checks every 30 min).
exec npm start
