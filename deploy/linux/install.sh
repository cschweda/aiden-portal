#!/usr/bin/env bash
# Installs (or refreshes) aiden-portal as a systemd user service: copies the production build and .env to
# ~/.local/share/aiden-portal, writes the unit, starts it, and waits for it to answer. It starts at boot (with
# lingering enabled), restarts on crash, and writes its own rotating log. Run it again after every `pnpm build`,
# every .env change, and every change of node version.
#
#   deploy/linux/install.sh
#   AIDEN_NODE=/usr/bin/node deploy/linux/install.sh   # if node is not on this shell's PATH
set -euo pipefail
# shellcheck source=deploy/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

fail() { echo "install: $*" >&2; exit 1; }
answers() { curl -s -o /dev/null --max-time 2 "$1/api/health"; }   # any HTTP answer at all, ours or not

command -v systemctl > /dev/null 2>&1 || fail "systemctl was not found; this installer needs systemd (Ubuntu 24.04 or newer)"
user_systemd_ready || fail "systemctl --user cannot reach a manager for this login. Over SSH on a server, run: sudo loginctl enable-linger $USER, then log in again"
[ -f "$REPO/.output/server/index.mjs" ] || fail "no production build at .output/server/index.mjs; run: pnpm build"
[ "$REPO/aiden.config.ts" -nt "$REPO/.output/server/index.mjs" ] \
  && fail "aiden.config.ts changed after the last build (it is compiled in); run: pnpm build"
[ -f "$REPO/.env" ] || fail "no .env in $REPO; copy .env.sample to .env and fill in FELLOW_EMAIL and FELLOW_PASSWORD"
mode=$(file_mode "$REPO/.env")
[ "$mode" = "600" ] || echo "install: warning: .env is mode $mode and holds your Fellow password; run: chmod 600 .env"

# systemd runs the service with no shell and no PATH, so the unit needs node's absolute path.
NODE=$(resolve_node "${AIDEN_NODE:-}") || exit 1

# Only the old service may hold the port; anything else answering is not ours.
url=$(app_url "$REPO")
systemctl --user stop "$SERVICE" 2>/dev/null || true
if answers "$url"; then
  fail "something else is listening at $url (pnpm dev, pnpm start, or the mock demo?); stop it, or set PORT in .env. While the service is installed, run the dev server elsewhere: PORT=5151 pnpm dev"
fi

mkdir -p "$APP_HOME" "$APP_HOME/logs" "$APP_HOME/data" "$UNIT_DIR"
chmod 700 "$APP_HOME" "$APP_HOME/logs" "$APP_HOME/data"
rsync -a --delete "$REPO/.output/" "$APP_HOME/.output/"
install -m 600 "$REPO/.env" "$APP_HOME/.env"
cp "$REPO/aiden.config.ts" "$APP_HOME/aiden.config.ts"   # the build has it compiled in; status.sh and logs.sh read this copy
echo "install: copied the build and .env to $APP_HOME"

# Render to a temporary file first, so a bad render never leaves a broken unit behind.
tmp="$UNIT.tmp"
render_unit "$NODE" "$APP_HOME" > "$tmp"
grep -q '__' "$tmp" && { rm -f "$tmp"; fail "the rendered unit still has placeholders in it; nothing was installed"; }
mv "$tmp" "$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$SERVICE" > /dev/null
systemctl --user restart "$SERVICE" || fail "systemctl could not start the service; see: journalctl --user -u $SERVICE -n 30"
echo "install: installed $UNIT (node: $NODE)"

# Without lingering the service stops when the last session of this user ends, which is wrong for a machine that
# should keep brewing coffee. It needs permission the first time; on a desktop that is a password prompt.
if ! loginctl show-user "$USER" --property=Linger 2>/dev/null | grep -q 'Linger=yes'; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    echo "install: lingering enabled, so the service runs whether or not you are logged in"
  else
    echo "install: warning: could not enable lingering; the service will stop when you log out. Run: sudo loginctl enable-linger $USER" >&2
  fi
fi

for _ in $(seq 1 40); do
  if curl -sf "$url/api/health" > /dev/null 2>&1; then
    echo "install: aiden-portal is running at $url"
    echo "install: app log: $APP_HOME/logs/current.log (deploy/linux/logs.sh follows it); systemd's own: journalctl --user -u $SERVICE"
    exit 0
  fi
  sleep 0.5
done
echo "install: the service is installed, but $url/api/health did not answer within 20 s" >&2
echo "install: run deploy/linux/status.sh; a configuration problem is printed in the journal and retried every 30 s" >&2
exit 1
