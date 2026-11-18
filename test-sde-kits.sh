#!/usr/bin/env bash
# End-to-end test of the Contract Guard and Dependency Watch starter kits with Podman (or Docker).
# Usage:
#   bash test-sde-kits.sh                                     (kit folders next to this script)
#   bash test-sde-kits.sh <contract-guard-kit> <dependency-watch-kit>
# Ports: webhook receiver 9900 (WEBHOOK_PORT), feed 7100 (FEED_PORT). Works with macOS Bash 3.2.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WH="${WEBHOOK_PORT:-9900}"; FEED="${FEED_PORT:-7100}"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  [PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "  [FAIL] $1"; }
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$1"; }
wait_for() { for _ in $(seq 1 "$3"); do [ "$(code "$1")" = "$2" ] && return 0; sleep 1; done; return 1; }
find_kit() { for d in "${2:-}" "${2:-}/$1" "$HERE/$1" "$HERE/$1/$1"; do
  [ -n "$d" ] && [ -f "$d/docker-compose.yml" ] && { (cd "$d" && pwd); return 0; }; done; return 1; }
CG=$(find_kit contract-guard-starter-kit "${1:-}") || { echo "Can't find the Contract Guard kit. Pass its folder as the first argument."; exit 1; }
DW=$(find_kit dependency-watch-starter-kit "${2:-}") || { echo "Can't find the Dependency Watch kit. Pass its folder as the second argument."; exit 1; }
echo "Contract Guard kit:   $CG"; echo "Dependency Watch kit: $DW"

if command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1; then ENGINE=podman
elif command -v docker >/dev/null 2>&1; then ENGINE=docker
elif command -v podman >/dev/null 2>&1; then echo "Podman is installed but not running: podman machine start"; exit 1
else echo "Neither podman nor docker found"; exit 1; fi
if $ENGINE compose version >/dev/null 2>&1; then COMPOSE="$ENGINE compose"
elif command -v podman-compose >/dev/null 2>&1; then COMPOSE="podman-compose"
else echo "No compose tool found (install podman-compose or Docker Compose)"; exit 1; fi
echo "Engine: $($ENGINE --version) | Compose: $COMPOSE"
export WEBHOOK_PORT="$WH" FEED_PORT="$FEED"

webhook_check() {
  wait_for "http://localhost:$WH/api/received" 200 60 && ok "webhook receiver up on $WH" || { bad "webhook receiver not up on $WH"; return; }
  curl -s -X DELETE "localhost:$WH/api/received" >/dev/null
  curl -s -X POST "localhost:$WH/test" -H 'Content-Type: application/json' -d '{"event":"kit-test"}' >/dev/null
  curl -s "localhost:$WH/api/received" | grep -q kit-test && ok "webhook stores notifications" || bad "webhook did not store"
  curl -s "localhost:$WH/" | grep -q kit-test && ok "webhook page shows them" || bad "webhook page"
}

# ================================================================ CONTRACT GUARD
echo; echo "=== Contract Guard starter kit"
n=$(ls "$CG"/specs/*/*.yaml 2>/dev/null | wc -l | tr -d ' ')
[ "$n" = "12" ] && ok "12 spec files (3 services x 4 versions)" || bad "expected 12 spec files, found $n"
n=$(ls "$CG"/consumers/*.yaml 2>/dev/null | wc -l | tr -d ' ')
[ "$n" = "4" ] && ok "4 consumer files" || bad "expected 4 consumer files, found $n"
for svc in quote-api policy-api claims-api; do
  v=$(grep -h '^  version:' "$CG"/specs/$svc/*.yaml | awk '{print $2}' | tr '\n' ' ')
  case $svc in quote-api) exp="1.0.0 1.1.0 2.0.0 2.1.0 ";; policy-api) exp="1.0.0 1.1.0 2.0.0 2.1.0 ";; claims-api) exp="1.0.0 1.1.0 1.1.0 2.0.0 ";; esac
  [ "$v" = "$exp" ] && ok "$svc versions in order: $v" || bad "$svc versions: '$v', expected '$exp'"
done
grep -q "x-sunset" "$CG/specs/policy-api/2-deprecations.yaml" && ok "deprecation markers present" || bad "deprecation markers missing"
grep -q "x-internal: true" "$CG/specs/quote-api/1-initial.yaml" && ok "internal endpoint marker present" || bad "internal marker missing"
(cd "$CG" && $COMPOSE up -d --build >/tmp/cg-up.log 2>&1) && ok "compose up" || bad "compose up (see /tmp/cg-up.log)"
webhook_check
(cd "$CG" && $COMPOSE down >/dev/null 2>&1) && ok "compose down"

# ================================================================ DEPENDENCY WATCH
echo; echo "=== Dependency Watch starter kit"
n=$(ls -d "$DW"/services/*/ 2>/dev/null | wc -l | tr -d ' ')
[ "$n" = "8" ] && ok "8 services" || bad "expected 8 services, found $n"
for s in "$DW"/services/*/; do [ -f "$s/service.yaml" ] || bad "$(basename "$s") has no service.yaml"; done
[ ! -f "$DW/services/docs-gen-svc/requirements.lock" ] && ok "docs-gen-svc has no lockfile (by design)" || bad "docs-gen-svc should have no lockfile"
grep -q '"lockfileVersion": 3' "$DW/services/payments-svc/package-lock.json" && ok "npm lockfiles are version 3" || bad "npm lockfile version"
(cd "$DW" && $COMPOSE up -d --build >/tmp/dw-up.log 2>&1) && ok "compose up" || bad "compose up (see /tmp/dw-up.log)"
wait_for "http://localhost:$FEED/control/state" 200 60 && ok "vulnerability feed up on $FEED" || bad "feed not up on $FEED"
curl -s -X POST "localhost:$FEED/control/feed/1" >/dev/null
cnt() { curl -s "$1" | grep -o '"count": [0-9]*' | head -1 | awk '{print $2}'; }
[ "$(cnt "localhost:$FEED/v1/advisories")" = "15" ] && ok "feed 1 serves 15 advisories" || bad "feed 1 count"
[ "$(cnt "localhost:$FEED/v1/advisories?ecosystem=npm")" = "7" ] && ok "ecosystem filter (7 npm)" || bad "ecosystem filter"
curl -s "localhost:$FEED/v1/advisories/DW-2026-0007" | grep -q '"name": "pyyaml"' && ok "single advisory lookup" || bad "single advisory lookup"
[ "$(code "localhost:$FEED/v1/advisories/DW-2026-9999")" = "404" ] && ok "unknown advisory returns 404" || bad "unknown advisory"
curl -s -X POST "localhost:$FEED/control/feed/2" >/dev/null
[ "$(cnt "localhost:$FEED/v1/advisories")" = "17" ] && ok "feed 2 serves 17 advisories" || bad "feed 2 count"
[ "$(cnt "localhost:$FEED/v1/advisories?modified_since=2026-11-10T00:00:00Z")" = "4" ] && ok "modified_since filter (4 changed)" || bad "modified_since filter"
curl -s "localhost:$FEED/v1/advisories/DW-2026-0010" | grep -q '"withdrawn"' && ok "feed 2 withdraws DW-2026-0010" || bad "withdrawn advisory"
curl -s -X POST "localhost:$FEED/control/feed/1" >/dev/null
[ "$(cnt "localhost:$FEED/v1/advisories")" = "15" ] && ok "switching back to feed 1" || bad "switch back"
webhook_check
q="$DW/services/quote-svc/package-lock.json"; p="$DW/services/payments-svc/package.json"
bash "$DW/scripts/change.sh" fix-quote-axios >/dev/null && grep -q '"version": "0.21.4"' "$q" && ok "change: fix-quote-axios" || bad "fix-quote-axios"
bash "$DW/scripts/change.sh" revert-quote-axios >/dev/null && grep -q '"version": "0.21.1"' "$q" && ok "change: revert-quote-axios" || bad "revert-quote-axios"
bash "$DW/scripts/change.sh" fix-payments-jwt >/dev/null && grep -q '"jsonwebtoken": "^9.0.0"' "$p" && ok "change: fix-payments-jwt" || bad "fix-payments-jwt"
bash "$DW/scripts/change.sh" reset >/dev/null
cmp -s "$q" "$DW/scripts/changes/original/quote-svc/package-lock.json" && cmp -s "$p" "$DW/scripts/changes/original/payments-svc/package.json" && ok "change: reset restores the originals" || bad "reset"
(cd "$DW" && $COMPOSE down >/dev/null 2>&1) && ok "compose down"

echo; echo "Summary: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] && echo "RESULT: BOTH KITS OK" || echo "RESULT: FIX THE FAILURES ABOVE"
