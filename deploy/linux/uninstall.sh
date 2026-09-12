#!/usr/bin/env bash
# Stops the aiden-portal service and removes its unit. With --purge, also removes the installed copy
# (~/.local/share/aiden-portal: the build, the .env copy, the app's logs, and the brew history in data/).
# The checkout is never touched, and lingering is left as it was in case other services rely on it.
set -euo pipefail
# shellcheck source=deploy/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if systemctl --user disable --now "$SERVICE" 2>/dev/null; then
  echo "uninstall: stopped and disabled $SERVICE"
else
  echo "uninstall: $SERVICE was not running"
fi
if [ -f "$UNIT" ]; then
  rm "$UNIT"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "uninstall: removed $UNIT"
fi
if [ "${1:-}" = "--purge" ]; then
  rm -rf "$APP_HOME"
  echo "uninstall: removed $APP_HOME"
else
  echo "uninstall: left the installed copy in $APP_HOME (use --purge to remove it)"
fi
