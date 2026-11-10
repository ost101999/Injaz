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

if [[ -e "$stage_app" || -e "$old_app" ]]; then
  echo "A previous installation is still being finalized. Close Injaz and try again."
  exit 1
fi

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
  osascript -e 'tell application "Finder" to delete POSIX file "/Applications/.injaz---advanced-task-manager.app.old"' || true
fi

env -u ELECTRON_RUN_AS_NODE open "$installed_app"
echo "Installed and opened: $installed_app"
