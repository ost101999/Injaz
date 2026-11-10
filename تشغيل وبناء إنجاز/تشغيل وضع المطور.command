#!/bin/bash

# Start Injaz in development mode. Vite refreshes UI changes automatically;
# keep this Terminal window open while previewing the app.
set -euo pipefail

tools_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$tools_dir/.." && pwd)"

cd "$project_dir"

if [[ ! -x "node_modules/.bin/concurrently" ]]; then
  echo "Dependencies are missing. Run npm install in the project folder first."
  read -r -p "Press Enter to close..."
  exit 1
fi

# The installed app shares the same data and Firebase session with development
# mode. Close it first so only one copy can make changes at a time.
osascript -e 'tell application id "com.injaz.app" to quit' >/dev/null 2>&1 || true
sleep 1

echo "Starting Injaz development mode. Keep this window open while using the app."
exec npm run electron:dev
