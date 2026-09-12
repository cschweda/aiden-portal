# shellcheck shell=bash
# Shared by the macOS install, status, logs, and uninstall scripts. Sourced, never run on its own.
# shellcheck disable=SC2034  # the variables are used by the scripts that source this file
# shellcheck source=deploy/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/../common.sh"

# The label predates the project's rename and stays as it is: changing it would orphan an existing install and the
# brew history under it.
LABEL="com.cschweda.aiden-studio"
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

# xml_esc VALUE: safe inside a plist <string>.
xml_esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# render_plist NODE APP_HOME LAUNCHD_LOG: the LaunchAgent template with its placeholders filled, on stdout.
render_plist() {
  sed -e "s/__LABEL__/$(sed_esc "$(xml_esc "$LABEL")")/g" \
      -e "s/__NODE__/$(sed_esc "$(xml_esc "$1")")/g" \
      -e "s/__APP_HOME__/$(sed_esc "$(xml_esc "$2")")/g" \
      -e "s/__LAUNCHD_LOG__/$(sed_esc "$(xml_esc "$3")")/g" \
      "$REPO/deploy/macos/$LABEL.plist.template"
}
