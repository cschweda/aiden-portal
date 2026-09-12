#!/usr/bin/env bash
# Shows whether the service is installed, enabled and running, whether the app answers, and the last log lines.
set -uo pipefail
# shellcheck source=deploy/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if [ ! -f "$UNIT" ]; then
  echo "status: $SERVICE is not installed (run deploy/linux/install.sh)"
elif ! user_systemd_ready; then
  echo "status: $SERVICE is installed at $UNIT, but systemctl --user cannot reach a manager for this login"
else
  state=$(systemctl --user is-active "$SERVICE" 2>/dev/null)
  enabled=$(systemctl --user is-enabled "$SERVICE" 2>/dev/null)
  pid=$(systemctl --user show "$SERVICE" --property=MainPID --value 2>/dev/null)
  result=$(systemctl --user show "$SERVICE" --property=Result --value 2>/dev/null)
  linger=$(loginctl show-user "$USER" --property=Linger --value 2>/dev/null)
  echo "status: $SERVICE is ${state:-unknown}; enabled: ${enabled:-unknown}; pid: ${pid:-none}; last result: ${result:-none}; lingering: ${linger:-unknown}"
fi

# The unit pins the absolute path of the node it was installed with; a version manager can delete that binary.
if [ -f "$UNIT" ]; then
  node=$(sed -n 's/^ExecStart=\([^ ]*\).*/\1/p' "$UNIT" | head -1)
  if [ -n "$node" ] && [ ! -x "$node" ]; then
    echo "status: node at $node is gone (changed node versions?); run deploy/linux/install.sh to pin the current one"
  fi
fi

url=$(app_url "$APP_HOME")
if body=$(curl -sf "$url/api/status" 2>/dev/null); then
  echo "status: $url answers: $body"
else
  echo "status: $url is not answering"
fi

if command -v journalctl > /dev/null 2>&1; then
  echo "--- journalctl --user -u $SERVICE (last 5 lines) ---"
  journalctl --user -u "$SERVICE" -n 5 --no-pager 2>/dev/null | cut -c1-200
fi
if [ -f "$APP_HOME/logs/current.log" ]; then
  echo "--- $APP_HOME/logs/current.log (last 5 lines) ---"
  tail -5 "$APP_HOME/logs/current.log" | cut -c1-200
fi
