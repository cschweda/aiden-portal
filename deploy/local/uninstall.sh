#!/usr/bin/env bash
# Stops the aiden-studio LaunchAgent and removes its plist. With --purge, also removes the installed copy
# (~/Library/Application Support/aiden-studio: the build, the .env copy, and the app's logs) and launchd's log
# directory (~/Library/Logs/aiden-studio). The checkout is never touched.
set -euo pipefail
# shellcheck source=deploy/local/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null; then
  echo "uninstall: stopped $LABEL"
else
  echo "uninstall: $LABEL was not running"
fi
if [ -f "$PLIST" ]; then
  rm "$PLIST"
  echo "uninstall: removed $PLIST"
fi
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$APP_HOME" "$LAUNCHD_LOG_DIR"
  echo "uninstall: removed $APP_HOME and $LAUNCHD_LOG_DIR"
else
  echo "uninstall: left the installed copy in $APP_HOME and launchd's log in $LAUNCHD_LOG_DIR (use --purge to remove them)"
fi
