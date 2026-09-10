#!/usr/bin/env bash
# Smoke-tests a production build the way Vitest cannot: real Nitro routing, nuxt-security headers, the
# startup guard, and the log file. Run after `pnpm build`. Exit code is non-zero if any check fails.
#
#   scripts/smoke.sh            # uses port 3995 and fake Fellow credentials (one harmless failed login)
#   PORT=4010 scripts/smoke.sh
set -u
cd "$(dirname "$0")/.."
PORT="${PORT:-3995}"
URL="http://127.0.0.1:${PORT}"
ENTRY=".output/server/index.mjs"
FAIL=0
pass() { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; FAIL=1; }
check() { # check <label> <expected-status> <curl args...>
  local label="$1" want="$2"; shift 2
  local got; got=$(curl -s -o /tmp/aiden-smoke.body -w '%{http_code}' "$@")
  if [ "$got" = "$want" ]; then pass "$label ($got)"; else fail "$label: expected $want, got $got: $(head -c 160 /tmp/aiden-smoke.body)"; fi
}
[ -f "$ENTRY" ] || { echo "No build found; run pnpm build first."; exit 1; }
export FELLOW_EMAIL="${FELLOW_EMAIL:-smoke@example.com}" FELLOW_PASSWORD="${FELLOW_PASSWORD:-not-a-real-password}" NODE_ENV=production FELLOW_DRY_RUN=true
SMOKE_LOGS="$(mktemp -d)"
cd "$SMOKE_LOGS" || exit 1
ENTRY_ABS="$OLDPWD/$ENTRY"

echo "Startup guard"
if HOST=0.0.0.0 node "$ENTRY_ABS" >/dev/null 2>&1; then fail "HOST=0.0.0.0 should refuse to start"; else pass "HOST=0.0.0.0 refused"; fi
if NITRO_HOST=0.0.0.0 node "$ENTRY_ABS" >/dev/null 2>&1; then fail "NITRO_HOST=0.0.0.0 should refuse to start"; else pass "NITRO_HOST=0.0.0.0 refused"; fi
if FELLOW_EMAIL= node "$ENTRY_ABS" >/dev/null 2>&1; then fail "missing credentials should refuse to start"; else pass "missing credentials refused"; fi

echo "Server"
PORT="$PORT" node "$ENTRY_ABS" > "$SMOKE_LOGS/stdout.txt" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; rm -rf "$SMOKE_LOGS" /tmp/aiden-smoke.body' EXIT
curl -s --retry 20 --retry-connrefused --retry-delay 1 "$URL/api/health" >/dev/null || { fail "server did not come up"; cat "$SMOKE_LOGS/stdout.txt"; exit 1; }
if grep -q "Listening on http://127.0.0.1:${PORT}" "$SMOKE_LOGS/stdout.txt"; then pass "bound to 127.0.0.1:${PORT}"; else fail "unexpected bind: $(grep -i listening "$SMOKE_LOGS/stdout.txt")"; fi

echo "Headers"
curl -sI "$URL/" > /tmp/aiden-smoke.body
for h in "content-security-policy" "x-frame-options: DENY" "x-content-type-options: nosniff" "referrer-policy"; do
  if grep -qi "$h" /tmp/aiden-smoke.body; then pass "page has $h"; else fail "page lacks $h"; fi
done
curl -sI "$URL/api/health" > /tmp/aiden-smoke.body
if grep -qi "x-request-id" /tmp/aiden-smoke.body; then pass "api has x-request-id"; else fail "api lacks x-request-id"; fi
if grep -qi "cache-control: no-store" /tmp/aiden-smoke.body; then pass "api is no-store"; else fail "api lacks cache-control: no-store"; fi

echo "Host allowlist"
check "allowed host" 200 "$URL/api/health"
check "foreign Host" 400 -H 'Host: evil.example' "$URL/api/health"
check "X-Forwarded-Host ignored" 200 -H 'X-Forwarded-Host: evil.example' "$URL/api/health"

echo "Same-site and CSRF"
check "bare POST" 403 -X POST "$URL/api/schedules"
check "Origin null" 403 -X POST -H 'Origin: null' "$URL/api/schedules"
check "lookalike Origin" 403 -X POST -H 'Origin: http://localhost.evil.example' "$URL/api/schedules"
check "cross-site GET" 403 -H 'Sec-Fetch-Site: cross-site' "$URL/api/device?fresh=1"
check "same-site GET" 403 -H 'Sec-Fetch-Site: same-site' "$URL/api/device"
check "direct navigation GET" 200 -H 'Sec-Fetch-Site: none' "$URL/api/health"
check "allowed Origin reaches validation" 400 -X POST -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' -d '{}' "$URL/api/schedules"

echo "Bodies and errors"
check "malformed JSON" 400 -X POST -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' -d '{bad' "$URL/api/profiles"
grep -q '"error":"bad_request"' /tmp/aiden-smoke.body && pass "malformed JSON uses our envelope" || fail "malformed JSON envelope: $(head -c 120 /tmp/aiden-smoke.body)"
check "malformed JSON on PATCH" 400 -X PATCH -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' -d '{bad' "$URL/api/profiles/p1"
check "__proto__ key" 400 -X POST -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' -d '{"__proto__":{"x":1}}' "$URL/api/schedules"
check "array body" 400 -X POST -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' -d '[1]' "$URL/api/profiles"
check "3 MB body" 413 -X POST -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' --data-binary @<(head -c 3000000 /dev/zero | tr '\0' 'a') "$URL/api/profiles"
check "2 MB PATCH body" 413 -X PATCH -H "Origin: http://127.0.0.1:${PORT}" -H 'content-type: application/json' --data-binary @<(head -c 2000000 /dev/zero | tr '\0' 'a') "$URL/api/profiles/p1"
check "traversal in id" 400 -X DELETE -H "Origin: http://127.0.0.1:${PORT}" "$URL/api/profiles/..%2Fstart%3Fconfirm%3Dtrue"
check "unknown API path" 404 "$URL/api/nope"
check "unsupported method" 404 -X POST -H "Origin: http://127.0.0.1:${PORT}" "$URL/api/profiles/p7"
check "status" 200 "$URL/api/status"
grep -q '"dryRun":true' /tmp/aiden-smoke.body && pass "status reports dry run" || fail "status body: $(cat /tmp/aiden-smoke.body)"
check "Fellow failure is a 502 with a code" 502 "$URL/api/device"
grep -q '"error":"fellow_auth_failed"' /tmp/aiden-smoke.body && pass "502 carries the code" || fail "502 body: $(cat /tmp/aiden-smoke.body)"
grep -q 'not-a-real-password\|smoke@example.com' /tmp/aiden-smoke.body && fail "502 leaked credentials" || pass "502 leaks no credential values"

echo "Logs"
if [ -L "$SMOKE_LOGS/logs/current.log" ]; then pass "logs/current.log symlink exists"; else fail "no logs/current.log symlink"; fi
if grep -q '"msg":"aiden-studio starting"' "$SMOKE_LOGS/logs/current.log" 2>/dev/null; then pass "startup record logged"; else fail "startup record missing"; fi
if grep -qi 'not-a-real-password' "$SMOKE_LOGS/logs/current.log" 2>/dev/null; then fail "password found in the log"; else pass "password absent from the log"; fi
if [ "$(stat -f '%Lp' "$SMOKE_LOGS/logs" 2>/dev/null || stat -c '%a' "$SMOKE_LOGS/logs")" = "700" ]; then pass "logs directory is owner-only"; else fail "logs directory permissions: $(stat -f '%Lp' "$SMOKE_LOGS/logs" 2>/dev/null)"; fi

echo
[ "$FAIL" -eq 0 ] && echo "SMOKE OK" || echo "SMOKE FAILED"
exit $FAIL
