# shellcheck shell=bash
# Helpers both platforms use. Sourced by deploy/macos/common.sh and deploy/linux/common.sh, never run on its own.
# shellcheck disable=SC2034  # the variables are used by the scripts that source this file
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
# lacks. Pass the installed directory for the running service, the checkout for what the next install will produce.
# IPv6 hosts are bracketed so curl can use the result.
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

# sed_esc VALUE: safe on the replacement side of s/…/…/.
sed_esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }

# resolve_node [HINT]: node's own absolute path, proving it runs and is new enough. Prints the path, or fails.
resolve_node() {
  local hint="${1:-}" candidate resolved major
  candidate="${hint:-$(command -v node || true)}"
  [ -n "$candidate" ] || { echo "node was not found on PATH; set AIDEN_NODE=/path/to/node" >&2; return 1; }
  resolved=$("$candidate" -p 'process.execPath' 2>/dev/null) || { echo "cannot run node at $candidate; set AIDEN_NODE=/path/to/node" >&2; return 1; }
  major=$("$resolved" -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge 22 ] || { echo "node at $resolved is v$major; aiden-portal needs Node 22" >&2; return 1; }
  printf '%s' "$resolved"
}

# file_mode PATH: the permission bits, on either BSD or GNU stat.
file_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }
