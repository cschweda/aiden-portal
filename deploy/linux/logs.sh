#!/usr/bin/env bash
# Follows the running service's log (JSON lines, secrets redacted). tail -F keeps following when pino-roll points
# current.log at a new file overnight. Ctrl-C to stop. Falls back to the journal while the app has written nothing.
set -uo pipefail
# shellcheck source=deploy/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
if [ -f "$APP_HOME/logs/current.log" ]; then
  exec tail -F "$APP_HOME/logs/current.log"
elif command -v journalctl > /dev/null 2>&1; then
  echo "logs: no app log yet at $APP_HOME/logs/current.log; following the journal instead (a refused configuration shows up there)"
  exec journalctl --user -u "$SERVICE" -f
else
  echo "logs: nothing to follow; is the service installed? (deploy/linux/install.sh)"
  exit 1
fi
