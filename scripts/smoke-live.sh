#!/usr/bin/env bash
# Live end-to-end smoke test against the deployed domain.
# Usage: scripts/smoke-live.sh [base-url] [ip]
set -euo pipefail

BASE="${1:-https://afribok.vertexsautomations.com}"
IP="${2:-54.37.5.101}"
HOST="$(printf '%s' "$BASE" | sed -E 's#^https?://##; s#/.*$##')"
RESOLVE=(--resolve "$HOST:443:$IP" --resolve "$HOST:80:$IP")
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
PASS=0
FAIL=0

check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf 'PASS  %-46s %s\n' "$label" "$actual"
    PASS=$((PASS + 1))
  else
    printf 'FAIL  %-46s got=%s want=%s\n' "$label" "$actual" "$expected"
    FAIL=$((FAIL + 1))
  fi
}

code() { curl -sS -o /dev/null -w '%{http_code}' "${RESOLVE[@]}" "$@"; }
body() { curl -sS "${RESOLVE[@]}" "$@"; }

echo "== transport =="
check "https landing page" "$(code --max-time 20 "$BASE/")" 200
check "http redirects to https" "$(code --max-time 20 "http://$HOST/")" 308
check "api health" "$(code --max-time 20 "$BASE/api/health")" 200
check "SPA deep route served" "$(code --max-time 20 "$BASE/patients")" 200

echo "== auth =="
LOGIN_HEADERS="$(curl -sS -D - -o /tmp/login.json -c "$JAR" "${RESOLVE[@]}" \
  -H 'content-type: application/json' \
  -d '{"email":"registration@afribok.health","password":"Afribok#2026"}' \
  "$BASE/api/auth/login")"
check "login status" "$(printf '%s' "$LOGIN_HEADERS" | head -1 | awk '{print $2}')" 200
check "session cookie is Secure" "$(printf '%s' "$LOGIN_HEADERS" | grep -ci 'set-cookie:.*secure')" 1
check "session cookie is HttpOnly" "$(printf '%s' "$LOGIN_HEADERS" | grep -ci 'set-cookie:.*httponly')" 1
check "GET /api/me" "$(body -b "$JAR" -o /dev/null -w '%{http_code}' "$BASE/api/me")" 200
check "unauthenticated /api/me blocked" "$(code --max-time 20 "$BASE/api/me")" 401

echo "== data =="
BOOTSTRAP="$(body -b "$JAR" "$BASE/api/bootstrap")"
PATIENTS="$(printf '%s' "$BOOTSTRAP" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["patients"]))')"
check "bootstrap patients = 11" "$PATIENTS" 11

STAMP="$(date +%s)"
UUID="$(cat /proc/sys/kernel/random/uuid)"
ENCOUNTER_UUID="$(cat /proc/sys/kernel/random/uuid)"
OP_ID="$(cat /proc/sys/kernel/random/uuid)"
PAYLOAD=$(cat <<JSON
{"operations":[{"id":"$OP_ID","type":"register_patient","clientTime":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)","payload":{
  "patient":{"id":"$UUID","hospitalNumber":"AFB-S$((STAMP % 100000))","firstName":"Smoke","lastName":"Test","sex":"female","dateOfBirth":"1994-04-12","phone":"0803 000 0000","address":"Wuse, Abuja","identifierType":"National ID","identifierValue":"NIN-SMOKE-$STAMP"},
  "encounter":{"id":"$ENCOUNTER_UUID","arrivedAt":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)","chiefComplaint":"Fever and cough for four days"},
  "duplicateAcknowledged":true}}]}
JSON
)
SYNC="$(body -b "$JAR" -H 'content-type: application/json' -d "$PAYLOAD" "$BASE/api/sync")"
check "sync registers patient" "$(printf '%s' "$SYNC" | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["status"])')" applied
REPLAY="$(body -b "$JAR" -H 'content-type: application/json' -d "$PAYLOAD" "$BASE/api/sync")"
check "sync replay is idempotent" "$(printf '%s' "$REPLAY" | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["status"])')" duplicate

echo "== roles =="
ADMIN_JAR="$(mktemp)"
trap 'rm -f "$JAR" "$ADMIN_JAR"' EXIT
curl -sS -o /dev/null -c "$ADMIN_JAR" "${RESOLVE[@]}" -H 'content-type: application/json' \
  -d '{"email":"admin@afribok.health","password":"Afribok#2026"}' "$BASE/api/auth/login"
check "audit readable by admin" "$(curl -sS -o /dev/null -w '%{http_code}' -b "$ADMIN_JAR" "${RESOLVE[@]}" "$BASE/api/audit")" 200
check "audit blocked for registration" "$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" "${RESOLVE[@]}" "$BASE/api/audit")" 403
check "logout" "$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "${RESOLVE[@]}" "$BASE/api/auth/logout")" 204

echo
echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
