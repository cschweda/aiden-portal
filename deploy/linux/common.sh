# shellcheck shell=bash
# Shared by the Linux install, status, logs, and uninstall scripts. Sourced, never run on its own.
# shellcheck disable=SC2034  # the variables are used by the scripts that source this file
# shellcheck source=deploy/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

SERVICE="aiden-portal.service"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/$SERVICE"
# The service runs from an installed copy of the build, so a rebuild or a git operation never touches a running
# service. install.sh refreshes the copy. systemd's own view of the process is in the journal.
APP_HOME="$HOME/.local/share/aiden-portal"

# render_unit NODE APP_HOME: the systemd template with its placeholders filled, on stdout.
render_unit() {
  sed -e "s/__NODE__/$(sed_esc "$1")/g" \
      -e "s/__APP_HOME__/$(sed_esc "$2")/g" \
      "$REPO/deploy/linux/$SERVICE.template"
}

# user_systemd_ready: true when `systemctl --user` can actually talk to a manager for this login.
user_systemd_ready() { systemctl --user show-environment > /dev/null 2>&1; }
