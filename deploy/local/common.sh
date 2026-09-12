# shellcheck shell=bash
# Shared by install.sh, status.sh, logs.sh, uninstall.sh, and scripts/check-shell.sh. Sourced, never run on its own.
# shellcheck disable=SC2034  # the variables are used by the scripts that source this file
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
# launchd never rotates it; it grows by two lines per start and is safe to delete.
LAUNCHD_LOG_DIR="$HOME/Library/Logs/aiden-studio"
LAUNCHD_LOG="$LAUNCHD_LOG_DIR/launchd.log"

# env_value FILE KEY: the last KEY=value line of a .env file, surrounding quotes removed; empty when unset or no file.
env_value() {
  local v
  v=$(grep -E "^[[:space:]]*$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  printf '%s' "$v"
}

# config_value FILE KEY: a top-level scalar from aiden.config.ts, written as `key: 'text'` or `key: 123`; empty when absent.
config_value() {
  grep -E "^[[:space:]]*$2:" "$1" 2>/dev/null | head -1 | sed -E "s/^[^:]*:[[:space:]]*'?([^',]+)'?.*/\1/" || true
}

# app_url DIR: where the app installed in DIR listens. Reads DIR/.env (NITRO_HOST beats HOST, NITRO_PORT beats PORT,
# the precedence the app uses) and DIR/aiden.config.ts, falling back to the checkout's config for a value the copy
# lacks. Pass $APP_HOME for the running service, $REPO for what the next install will produce. IPv6 hosts are
# bracketed so curl can use the result.
app_url() {
  local dir="$1" config="$1/aiden.config.ts" host port
  [ -f "$config" ] || config="$REPO/aiden.config.ts"
  host=$(env_value "$dir/.env" NITRO_HOST); [ -n "$host" ] || host=$(env_value "$dir/.env" HOST)
  port=$(env_value "$dir/.env" NITRO_PORT); [ -n "$port" ] || port=$(env_value "$dir/.env" PORT)
  [ -n "$host" ] || host=$(config_value "$config" host)
  [ -n "$port" ] || port=$(config_value "$config" port)
  host="${host:-127.0.0.1}"
  case "$host" in
    \[*) ;;
    *:*) host="[$host]" ;;
  esac
  printf 'http://%s:%s' "$host" "${port:-5150}"
}

# xml_esc VALUE: safe inside a plist <string>. sed_esc VALUE: safe on the replacement side of s/…/…/.
xml_esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
sed_esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

# render_plist NODE APP_HOME LAUNCHD_LOG: the LaunchAgent template with its placeholders filled, on stdout.
render_plist() {
  sed -e "s/__LABEL__/$(sed_esc "$(xml_esc "$LABEL")")/g" \
      -e "s/__NODE__/$(sed_esc "$(xml_esc "$1")")/g" \
      -e "s/__APP_HOME__/$(sed_esc "$(xml_esc "$2")")/g" \
      -e "s/__LAUNCHD_LOG__/$(sed_esc "$(xml_esc "$3")")/g" \
      "$REPO/deploy/local/$LABEL.plist.template"
}
