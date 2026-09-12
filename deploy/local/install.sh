#!/usr/bin/env bash
# Installs (or refreshes) aiden-studio as a launchd LaunchAgent for the current user: copies the production build
# and .env to ~/Library/Application Support/aiden-studio, loads the service, and waits for it to answer. It starts
# at login, restarts on crash, and logs to its own directory. Run it again after every `pnpm build`, every .env
# change, and every change of node version.
#
#   deploy/local/install.sh
#   AIDEN_NODE=/opt/homebrew/bin/node deploy/local/install.sh   # if node is not on this shell's PATH
set -euo pipefail
# shellcheck source=deploy/local/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

fail() { echo "install: $*" >&2; exit 1; }
loaded() { launchctl print "$DOMAIN/$LABEL" > /dev/null 2>&1; }
answers() { curl -s -o /dev/null --max-time 2 "$1/api/health"; }   # any HTTP answer at all, ours or not

[ -f "$REPO/.output/server/index.mjs" ] || fail "no production build at .output/server/index.mjs; run: pnpm build"
[ "$REPO/aiden.config.ts" -nt "$REPO/.output/server/index.mjs" ] \
  && fail "aiden.config.ts changed after the last build (it is compiled in); run: pnpm build"
[ -f "$REPO/.env" ] || fail "no .env in $REPO; copy .env.sample to .env and fill in FELLOW_EMAIL and FELLOW_PASSWORD"
mode=$(stat -f '%Lp' "$REPO/.env")
[ "$mode" = "600" ] || echo "install: warning: .env is mode $mode and holds your Fellow password; run: chmod 600 .env"

# launchd runs the job with no shell and no PATH, so the plist needs node's absolute path with symlinks resolved.
# Node reports its own (process.execPath), which also proves the binary runs.
NODE="${AIDEN_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || fail "node was not found on PATH; set AIDEN_NODE=/path/to/node"
real_node=$("$NODE" -p 'process.execPath' 2>/dev/null) || fail "cannot run node at $NODE; set AIDEN_NODE=/path/to/node"
NODE="$real_node"
major=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "node at $NODE is v$major; aiden-studio needs Node 22"
case "$NODE" in
  /Volumes/*) echo "install: warning: node lives on an external volume ($NODE); macOS may not let launchd start it. Prefer a node installed on the internal disk." ;;
esac

# Only the old service may hold the port. Stop it, and wait until launchd has really let go of it: bootout returns
# before the teardown finishes, and a bootstrap that races it fails. Then anything still answering is not ours.
url=$(app_url "$REPO")
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in $(seq 1 20); do
  loaded || break
  sleep 0.5
done
if loaded; then
  fail "the running service did not stop within 10 s; run: launchctl bootout $DOMAIN/$LABEL, then try again"
fi
if answers "$url"; then
  fail "something else is listening at $url (pnpm dev, pnpm start, or the mock demo?); stop it, or set PORT in .env. While the service is installed, run the dev server elsewhere: PORT=3001 pnpm dev"
fi

mkdir -p "$APP_HOME" "$APP_HOME/logs" "$APP_HOME/data" "$PLIST_DIR" "$LAUNCHD_LOG_DIR"
chmod 700 "$APP_HOME" "$APP_HOME/logs" "$APP_HOME/data" "$LAUNCHD_LOG_DIR"
rsync -a --delete "$REPO/.output/" "$APP_HOME/.output/"
install -m 600 "$REPO/.env" "$APP_HOME/.env"
cp "$REPO/aiden.config.ts" "$APP_HOME/aiden.config.ts"   # the build has it compiled in; status.sh and logs.sh read this copy
echo "install: copied the build and .env to $APP_HOME"

# Render and lint in a temporary file, so a bad render never leaves a broken plist in LaunchAgents.
tmp="$PLIST.tmp"
render_plist "$NODE" "$APP_HOME" "$LAUNCHD_LOG" > "$tmp"
plutil -lint "$tmp" > /dev/null || { rm -f "$tmp"; fail "the rendered plist did not lint; nothing was loaded"; }
mv "$tmp" "$PLIST"
launchctl bootstrap "$DOMAIN" "$PLIST" \
  || fail "launchctl bootstrap failed; run this installer again, and if aiden-studio is switched off in System Settings > General > Login Items & Extensions, switch it on first"
echo "install: loaded $PLIST (node: $NODE)"

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
