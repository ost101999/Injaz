#!/bin/bash

# Build Injaz, replace the installed macOS app only after a successful build,
# and launch the replacement.  The previous app is moved to the Trash.
set -euo pipefail

tools_dir="$(cd "$(dirname "$0")" && pwd)"
project_dir="$(cd "$tools_dir/.." && pwd)"
app_name="injaz---advanced-task-manager.app"
source_app="$project_dir/release/mac-arm64/$app_name"
installed_app="/Applications/$app_name"
stage_app="/Applications/.$app_name.new"
old_app="/Applications/.$app_name.old"

# Clean up any leftover temporary files from a previous run automatically.
if [[ -e "$stage_app" ]]; then
  echo "Cleaning up previous staging app..."
  rm -rf "$stage_app"
fi

if [[ -e "$old_app" ]]; then
  if [[ ! -e "$installed_app" ]]; then
    echo "Restoring previous installation..."
    mv "$old_app" "$installed_app"
  else
    echo "Cleaning up previous backup app..."
    osascript -e 'tell application "Finder" to delete POSIX file "'"$old_app"'"' >/dev/null 2>&1 || rm -rf "$old_app"
  fi
fi

# Close any running copy of Injaz (installed or dev preview) first.
echo "Closing Injaz if running..."
osascript -e 'tell application id "com.injaz.app" to quit' >/dev/null 2>&1 || true
killall "injaz---advanced-task-manager" >/dev/null 2>&1 || true
pkill -f "$project_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" >/dev/null 2>&1 || true
sleep 1

cd "$project_dir"
if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "Checking for latest commits from GitHub..."
  git pull --ff-only || true
fi
npm run dist

if [[ ! -d "$source_app" ]]; then
  echo "The macOS application was not created: $source_app"
  exit 1
fi

# Close a running copy before its files are replaced.  It is harmless when it
# is not running.
osascript -e 'tell application id "com.injaz.app" to quit' >/dev/null 2>&1 || true
sleep 1

# Copy first, so a build/copy failure never removes the installed application.
ditto "$source_app" "$stage_app"

if [[ -e "$installed_app" ]]; then
  mv "$installed_app" "$old_app"
fi

if ! mv "$stage_app" "$installed_app"; then
  [[ -e "$old_app" && ! -e "$installed_app" ]] && mv "$old_app" "$installed_app"
  exit 1
fi

# Finder deletion is recoverable: it moves the old application to the Trash.
if [[ -e "$old_app" ]]; then
  osascript -e 'tell application "Finder" to delete POSIX file "'"$old_app"'"' >/dev/null 2>&1 || rm -rf "$old_app"
fi

env -u ELECTRON_RUN_AS_NODE open "$installed_app"
echo "Installed and opened: $installed_app"

# Build and install succeeded: close this Terminal window automatically.
# (Reached only on success; any failure above exits early with `set -e`, leaving the window open for the error.)
sleep 2
tty_name="$(tty 2>/dev/null || true)"
if [[ -n "$tty_name" && "$tty_name" != "not a tty" ]]; then
  (
    sleep 1
    osascript - "$tty_name" >/dev/null 2>&1 <<'APPLESCRIPT'
on run argv
  set myTTY to item 1 of argv
  tell application "Terminal"
    -- 1) Close the window that ran this script (matched by its tab's tty).
    repeat with w in (every window)
      try
        repeat with t in (tabs of w)
          if (tty of t) is myTTY then
            close w saving no
            exit repeat
          end if
        end repeat
      end try
    end repeat
    delay 0.5
    -- 2) Terminal opens an extra blank "Last login..." window when it is launched by a .command file;
    --    close it too if it is idle and still empty.
    repeat with w in (every window)
      try
        set t to selected tab of w
        if (busy of t) is false then
          set c to contents of t
          if c starts with "Last login" then
            set n to (do shell script "printf %s " & quoted form of c & " | grep -c '[^[:space:]]' || true") as integer
            if n <= 2 then close w saving no
          end if
        end if
      end try
    end repeat
    -- 3) Nothing left open: quit Terminal.
    if (count of windows) is 0 then quit
  end tell
end run
APPLESCRIPT
  ) &
  disown
fi
exit 0
