#!/usr/bin/env bash
# Start the learning playground at http://localhost:5199 (installs deps on first run).
set -euo pipefail

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")"

# Homebrew's node isn't always on PATH in non-login shells.
for p in /opt/homebrew/bin /usr/local/bin; do
  [[ -d "$p" && ":$PATH:" != *":$p:"* ]] && PATH="$p:$PATH"
done
export PATH

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js first: brew install node" >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies…"
  npm install --no-fund --no-audit
fi

exec npm start
