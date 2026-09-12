#!/usr/bin/env bash
# Shows whether the LaunchAgent is installed, loaded, and running, whether the app answers, and the last log lines.
set -uo pipefail
# shellcheck source=deploy/macos/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

if info=$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null); then
  pid=$(printf '%s\n' "$info" | grep -E '^[[:space:]]*pid = ' | awk '{print $3}')
  state=$(printf '%s\n' "$info" | grep -E '^[[:space:]]*state = ' | head -1 | awk '{print $3}')
  last=$(printf '%s\n' "$info" | grep -E 'last exit (code|reason)' | head -1 | sed -E 's/^[[:space:]]+//')
  echo "status: $LABEL is loaded; state: ${state:-?}; pid: ${pid:-none}; ${last:-no exit recorded}"
elif [ -f "$PLIST" ]; then
  echo "status: $LABEL has a plist at $PLIST but is not loaded (switched off in System Settings > General > Login Items & Extensions? run deploy/macos/install.sh)"
else
  echo "status: $LABEL is not installed (run deploy/macos/install.sh)"
fi

# The plist pins the absolute path of the node the service was installed with. nvm and fnm delete old versions on
# upgrade, and launchd has nothing to report when the binary is gone: nothing runs, so nothing is logged.
if [ -f "$PLIST" ]; then
  node=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$PLIST" 2>/dev/null || true)
  if [ -n "$node" ] && [ ! -x "$node" ]; then
    echo "status: node at $node is gone (changed node versions?); run deploy/macos/install.sh to pin the current one"
  fi
fi

url=$(app_url "$APP_HOME")
if body=$(curl -sf "$url/api/status" 2>/dev/null); then
  echo "status: $url answers: $body"
else
  echo "status: $url is not answering"
fi

if [ -f "$LAUNCHD_LOG" ]; then
  echo "--- $LAUNCHD_LOG (last 5 lines) ---"
  tail -5 "$LAUNCHD_LOG" | cut -c1-200
fi
if [ -f "$APP_HOME/logs/current.log" ]; then
  echo "--- $APP_HOME/logs/current.log (last 5 lines) ---"
  tail -5 "$APP_HOME/logs/current.log" | cut -c1-200
fi
