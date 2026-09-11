# Shared by install.sh, status.sh, logs.sh, and uninstall.sh. Not meant to be run on its own.
LABEL="com.cschweda.aiden-studio"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"
# The service runs from an installed copy of the build on the internal disk, not from the checkout: macOS does not
# let unattended processes read removable volumes, and a rebuild or a git operation should never touch a running
# service. install.sh refreshes the copy.
APP_HOME="$HOME/Library/Application Support/aiden-studio"
# launchd's own stdout/stderr for the job (startup lines and crash traces only; the app's log is in $APP_HOME/logs).
LAUNCHD_LOG="$HOME/Library/Logs/aiden-studio/launchd.log"

# Where the app listens: .env overrides beat aiden.config.ts, the same precedence the app uses.
app_url() {
  local env_file="$1" host="" port=""
  if [ -f "$env_file" ]; then
    host=$(grep -E '^(NITRO_HOST|HOST)=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
    port=$(grep -E '^(NITRO_PORT|PORT)=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
  fi
  [ -n "$host" ] || host=$(grep -E "^[[:space:]]*host:" "$REPO/aiden.config.ts" | head -1 | sed -E "s/.*host:[[:space:]]*'([^']+)'.*/\1/")
  [ -n "$port" ] || port=$(grep -E "^[[:space:]]*port:" "$REPO/aiden.config.ts" | head -1 | sed -E 's/.*port:[[:space:]]*([0-9]+).*/\1/')
  printf 'http://%s:%s' "${host:-127.0.0.1}" "${port:-3000}"
}
