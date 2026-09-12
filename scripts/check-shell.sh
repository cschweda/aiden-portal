#!/usr/bin/env bash
# Static checks for the shell side of the project, run by `pnpm lint`: bash syntax for every script, shellcheck when
# it is installed, and a render of each service template with awkward characters in every path. Needs no build, runs
# on either platform, and writes only to a temporary directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

fail() { echo "check-shell: $*" >&2; exit 1; }

for f in deploy/*.sh deploy/*/*.sh scripts/*.sh; do
  bash -n "$f" || fail "syntax error in $f"
done
echo "check-shell: bash -n ok"

if command -v shellcheck > /dev/null 2>&1; then
  shellcheck -x deploy/*.sh deploy/*/*.sh scripts/*.sh || fail "shellcheck found problems"
  echo "check-shell: shellcheck ok"
else
  echo "check-shell: shellcheck not installed, skipped (brew install shellcheck, apt install shellcheck, or: pnpm dlx shellcheck -x deploy/*/*.sh scripts/*.sh)"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
home="$tmp/Application Support & <odd> name/aiden-portal"

# macOS: the LaunchAgent must render to valid XML and read back the path it was given.
# shellcheck source=deploy/macos/common.sh
source deploy/macos/common.sh
render_plist "$tmp/node bin/node" "$home" "$home/launchd.log" > "$tmp/rendered.plist"
grep -q '__' "$tmp/rendered.plist" && fail "placeholders left in the rendered plist"
if command -v plutil > /dev/null 2>&1; then
  plutil -lint "$tmp/rendered.plist" > /dev/null || fail "the rendered plist does not lint"
  back=$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$tmp/rendered.plist")
  [ "$back" = "$home" ] || fail "WorkingDirectory did not survive the render: $back"
  echo "check-shell: the LaunchAgent renders, lints, and reads back"
else
  echo "check-shell: plutil not available (not macOS), so the plist was rendered but not linted"
fi

# Linux: the unit must render with every placeholder filled and the directives the installer relies on.
# shellcheck source=deploy/linux/common.sh
source deploy/linux/common.sh
render_unit "/usr/bin/node" "$home" > "$tmp/rendered.service"
grep -q '__' "$tmp/rendered.service" && fail "placeholders left in the rendered unit"
for key in "WorkingDirectory=$home" "ExecStart=/usr/bin/node --env-file=.env .output/server/index.mjs" "Restart=on-failure" "RestartSec=30" "ReadWritePaths=$home" "WantedBy=default.target"; do
  grep -qF "$key" "$tmp/rendered.service" || fail "the rendered unit lacks: $key"
done
if command -v systemd-analyze > /dev/null 2>&1; then
  systemd-analyze verify --user "$tmp/rendered.service" || fail "systemd-analyze rejected the unit"
  echo "check-shell: the systemd unit renders and verifies"
else
  echo "check-shell: systemd-analyze not available (not Linux), so the unit was rendered and checked key by key"
fi
