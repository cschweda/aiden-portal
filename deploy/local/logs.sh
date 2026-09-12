#!/usr/bin/env bash
# Follows the running service's log (JSON lines, secrets redacted). tail -F keeps following when pino-roll points
# current.log at a new file overnight. Ctrl-C to stop. Falls back to launchd's log while the app has not written one.
set -uo pipefail
# shellcheck source=deploy/local/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
if [ -f "$APP_HOME/logs/current.log" ]; then
  exec tail -F "$APP_HOME/logs/current.log"
elif [ -f "$LAUNCHD_LOG" ]; then
  echo "logs: no app log yet at $APP_HOME/logs/current.log; following $LAUNCHD_LOG instead (a refused configuration shows up there)"
  exec tail -F "$LAUNCHD_LOG"
else
  echo "logs: nothing to follow; is the service installed? (deploy/local/install.sh)"
  exit 1
fi
