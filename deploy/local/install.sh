#!/usr/bin/env bash
# Installs (or refreshes) aiden-studio as a launchd LaunchAgent for the current user: copies the production build
# and .env to ~/Library/Application Support/aiden-studio, loads the service, and waits for it to answer. It starts
# at login, restarts on crash, and logs to its own directory. Run it again after every `pnpm build` or .env change.
#
#   deploy/local/install.sh
#   AIDEN_NODE=/opt/homebrew/bin/node deploy/local/install.sh   # if node is not on this shell's PATH
set -euo pipefail
# shellcheck source=deploy/local/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

fail() { echo "install: $*" >&2; exit 1; }

[ -f "$REPO/.output/server/index.mjs" ] || fail "no production build at .output/server/index.mjs; run: pnpm build"
[ -f "$REPO/.env" ] || fail "no .env in $REPO; copy .env.sample to .env and fill in FELLOW_EMAIL and FELLOW_PASSWORD"
mode=$(stat -f '%Lp' "$REPO/.env")
[ "$mode" = "600" ] || echo "install: warning: .env is mode $mode and holds your Fellow password; run: chmod 600 .env"

NODE="${AIDEN_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || fail "node was not found on PATH; set AIDEN_NODE=/path/to/node"
NODE="$(cd "$(dirname "$NODE")" && pwd)/$(basename "$NODE")"
major=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "node at $NODE is v$major; aiden-studio needs Node 22"
case "$NODE" in
  /Volumes/*) echo "install: warning: node lives on an external volume ($NODE); macOS may not let launchd start it. Prefer a node installed on the internal disk." ;;
esac

# Stop the running service before replacing its files.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

mkdir -p "$APP_HOME" "$APP_HOME/logs" "$PLIST_DIR" "$(dirname "$LAUNCHD_LOG")"
chmod 700 "$APP_HOME" "$APP_HOME/logs"
rsync -a --delete "$REPO/.output/" "$APP_HOME/.output/"
install -m 600 "$REPO/.env" "$APP_HOME/.env"
cp "$REPO/aiden.config.ts" "$APP_HOME/aiden.config.ts"   # for reference only; the build has it compiled in
echo "install: copied the build and .env to $APP_HOME"

esc() { printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'; }
sed -e "s/__LABEL__/$(esc "$LABEL")/g" -e "s/__NODE__/$(esc "$NODE")/g" -e "s/__APP_HOME__/$(esc "$APP_HOME")/g" -e "s/__LAUNCHD_LOG__/$(esc "$LAUNCHD_LOG")/g" \
  "$REPO/deploy/local/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" > /dev/null
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "install: loaded $PLIST (node: $NODE)"

url=$(app_url "$APP_HOME/.env")
for _ in $(seq 1 40); do
  if curl -sf "$url/api/health" > /dev/null 2>&1; then
    echo "install: aiden-studio is running at $url"
    echo "install: app log: $APP_HOME/logs/current.log (deploy/local/logs.sh follows it); launchd log: $LAUNCHD_LOG"
    exit 0
  fi
  sleep 0.5
done
echo "install: the service is installed, but $url/api/health did not answer within 20 s" >&2
echo "install: run deploy/local/status.sh; a configuration problem is printed in $LAUNCHD_LOG and retried every 30 s" >&2
exit 1
