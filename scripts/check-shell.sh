#!/usr/bin/env bash
# Static checks for the shell side of the project, run by `pnpm lint`: bash syntax for every script, shellcheck when
# it is installed, and a render of the launchd template with awkward characters in every path, linted by plutil and
# read back. Needs no build and writes only to a temporary directory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
# shellcheck source=deploy/local/common.sh
source deploy/local/common.sh

fail() { echo "check-shell: $*" >&2; exit 1; }

for f in deploy/local/*.sh scripts/*.sh; do
  bash -n "$f" || fail "syntax error in $f"
done
echo "check-shell: bash -n ok"

if command -v shellcheck > /dev/null 2>&1; then
  shellcheck -x deploy/local/*.sh scripts/*.sh || fail "shellcheck found problems"
  echo "check-shell: shellcheck ok"
else
  echo "check-shell: shellcheck not installed, skipped (brew install shellcheck, or: pnpm dlx shellcheck -x deploy/local/*.sh scripts/*.sh)"
fi

if command -v plutil > /dev/null 2>&1; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  home="$tmp/Application Support & <odd> name/aiden-studio"
  render_plist "$tmp/node bin/node" "$home" "$home/launchd.log" > "$tmp/rendered.plist"
  plutil -lint "$tmp/rendered.plist" > /dev/null || fail "the rendered plist does not lint"
  if grep -q '__' "$tmp/rendered.plist"; then fail "placeholders left in the rendered plist"; fi
  back=$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$tmp/rendered.plist")
  [ "$back" = "$home" ] || fail "WorkingDirectory did not survive the render: $back"
  echo "check-shell: plist template renders, lints, and reads back"
else
  echo "check-shell: plutil not available (not macOS), template render skipped"
fi
