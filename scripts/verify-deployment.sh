#!/usr/bin/env bash
# Verifies that a Zteam deployment is safe for installed apps (Windows EXE / Android APK / browsers):
# new releases must be picked up on refresh, deep links must reload, and nothing may be cached
# in a way that serves an old index.html.
#
# Usage:  scripts/verify-deployment.sh https://zteam.zeekerstech.com
set -u
BASE="${1:-https://zteam.zeekerstech.com}"; BASE="${BASE%/}"
fail=0; warn=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }
note() { printf '  WARN  %s\n' "$1"; warn=$((warn+1)); }
hdr()  { curl -sS -m 20 -D - -o /dev/null "$1" | tr -d '\r'; }
status() { hdr "$1" | head -1 | awk '{print $2}'; }
header() { hdr "$1" | grep -i "^$2:" | head -1 | cut -d: -f2- | sed 's/^ *//'; }
nocache() { echo "$1" | grep -qiE 'no-cache|no-store|max-age=0|must-revalidate'; }

echo "Checking $BASE"
case "$BASE" in https://*) ok "served over HTTPS";; *) note "not HTTPS (APK blocks cleartext traffic)";; esac

echo "1. Entry files must always be re-checked with the server (otherwise apps keep an old index.html)"
for f in "/" "/version.json" "/sw.js" "/manifest.json"; do
  cc="$(header "$BASE$f" cache-control)"; code="$(status "$BASE$f")"
  [ "$code" = "200" ] || { bad "$f -> HTTP $code"; continue; }
  if nocache "$cc"; then ok "$f  Cache-Control: $cc"; else bad "$f  Cache-Control is '${cc:-<none>}'  -> add: Cache-Control: no-cache"; fi
done

echo "2. Build fingerprint"
v="$(curl -sS -m 20 "$BASE/version.json?t=$(date +%s)")"
echo "$v" | grep -q '"build"' && ok "version.json -> $v" || bad "version.json missing or invalid ($v)"

echo "3. Hashed assets"
html="$(curl -sS -m 20 "$BASE/")"
js="$(echo "$html" | grep -oE '/assets/[^"]+\.js' | head -1)"
if [ -n "$js" ]; then
  [ "$(status "$BASE$js")" = "200" ] && ok "$js -> 200" || bad "$js -> not found (index.html points at a deleted file = blank page)"
  ct="$(header "$BASE$js" content-type)"; echo "$ct" | grep -qiE 'javascript' && ok "asset content-type: $ct" || bad "asset served as '$ct' (module scripts need JavaScript)"
  cc="$(header "$BASE$js" cache-control)"; echo "$cc" | grep -qiE 'immutable|max-age=[0-9]{5,}' && ok "asset cached long-term: $cc" || note "assets have no long-term cache ('${cc:-<none>}'): works, just slower"
else bad "index.html references no /assets/*.js (is the build using base './'?)"; fi
echo "$html" | grep -qE 'src="\./|href="\./assets' && bad "index.html uses RELATIVE asset paths: reloading /chat/6 will go blank"

echo "4. Deep links reload (SPA fallback)"
for p in /chat/1 /groups/1 /meetings; do
  code="$(status "$BASE$p")"; ct="$(header "$BASE$p" content-type)"
  [ "$code" = "200" ] && echo "$ct" | grep -qi html && ok "$p -> 200 $ct" || bad "$p -> HTTP $code ($ct): reload on this page would fail"
done

echo "5. Backend"
code="$(status "$BASE/api/health")"; [ "$code" = "200" ] && ok "/api/health -> 200" || bad "/api/health -> HTTP $code"

echo; echo "Result: $fail failed, $warn warnings"; [ "$fail" -eq 0 ]
