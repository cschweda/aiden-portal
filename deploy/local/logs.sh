#!/usr/bin/env bash
# Follows the running service's log (JSON lines, secrets redacted). Ctrl-C to stop.
set -uo pipefail
# shellcheck source=deploy/local/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[ -f "$APP_HOME/logs/current.log" ] || { echo "logs: no log yet at $APP_HOME/logs/current.log (is the service installed?)"; exit 1; }
exec tail -f "$APP_HOME/logs/current.log"
