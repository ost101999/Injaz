#!/bin/bash

# Start Injaz in shared development mode. It uses the installed app's profile
# and file:// storage, so it opens with the same local and Firebase data.
set -euo pipefail

# Electron must launch its graphical runtime, not inherit Node-only mode.
unset ELECTRON_RUN_AS_NODE

tools_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$tools_dir/.." && pwd)"

cd "$project_dir"

if [[ ! -x "node_modules/.bin/concurrently" ]]; then
  echo "Dependencies are missing. Run npm install in the project folder first."
  read -r -p "Press Enter to close..."
  exit 1
fi

electron_executable="$project_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if pgrep -f "$electron_executable" >/dev/null; then
  echo "Developer mode is already running. Bringing it to the front."
  open -a Electron
  exit 0
fi

# The preview shares the installed profile, so keep only one copy running.
osascript -e 'tell application id "com.injaz.app" to quit' >/dev/null 2>&1 || true
sleep 1

echo "Starting Injaz development mode. Keep this window open while using the app."
npm run build
npm run compile:electron
export INJAZ_SHARED_PREVIEW=1
exec node_modules/.bin/concurrently -k 'npm run build -- --watch' 'node electron/launch-electron.cjs .'
