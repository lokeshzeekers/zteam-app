#!/usr/bin/env bash
# Tests for scripts/publish-client.sh. Uses only temp directories; run:  scripts/test-publish-client.sh
# shellcheck disable=SC2034   # snap_before/snap_after/good are read inside the eval'd check strings
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
PUBLISH="${PUBLISH_SCRIPT:-$HERE/publish-client.sh}"   # override to run the same tests against another implementation
T=$(mktemp -d /tmp/zteam-publish-test.XXXXXX)
trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  PASS  %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL  %s\n' "$1"; }
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; printf '        condition: %s\n' "$2"; fi; }
section() { printf '\n%s\n' "$1"; }

# mkdist <dir> <build-id> <asset-hash>... : a fake `vite build` output
mkdist() {
  local d=$1 build=$2; shift 2
  rm -rf "$d"; mkdir -p "$d/assets"
  local scripts="" h
  for h in "$@"; do
    printf 'js %s %s\n' "$h" "$build" >"$d/assets/index-$h.js"
    printf 'css %s %s\n' "$h" "$build" >"$d/assets/index-$h.css"
    scripts="$scripts<script type=\"module\" src=\"/assets/index-$h.js\"></script><link rel=\"stylesheet\" href=\"/assets/index-$h.css\">"
  done
  printf '<!doctype html><html><head><link rel="manifest" href="/manifest.json">%s</head><body>build %s</body></html>\n' "$scripts" "$build" >"$d/index.html"
  printf '{"build":"%s"}' "$build" >"$d/version.json"
  printf '// sw %s\n' "$build" >"$d/sw.js"
  printf '{"name":"Zteam","build":"%s"}' "$build" >"$d/manifest.json"
  printf 'png-%s' "$build" >"$d/icon.png"
}
snapshot() { (cd "$1" && find . \( -type f -o -type l \) -print0 | sort -z | xargs -0 -r sha1sum 2>/dev/null; find . -type l -printf '%p -> %l\n' | sort); }
run() { bash "$PUBLISH" "$@" >"$T/out.log" 2>&1; echo $?; }

# ---------------------------------------------------------------------------------------------
section "1. First deployment into an empty web root"
mkdist "$T/dA" "buildA" AAAAAAAA
W="$T/www1/zteam"
rc=$(run "$T/dA" "$W"); check "exits 0" "[ $rc = 0 ]"
check "index.html, version.json, sw.js, manifest.json, icon published" "cmp -s $T/dA/index.html $W/index.html && cmp -s $T/dA/version.json $W/version.json && cmp -s $T/dA/sw.js $W/sw.js && cmp -s $T/dA/manifest.json $W/manifest.json && cmp -s $T/dA/icon.png $W/icon.png"
check "assets published" "cmp -s $T/dA/assets/index-AAAAAAAA.js $W/assets/index-AAAAAAAA.js"
check "no temp / backup leftovers" "[ -z \"\$(find $W -name '.*.new.*' -o -name '.*.restore.*')\" ] && [ -z \"\$(ls -d /tmp/zteam-publish.* 2>/dev/null)\" ]"

# ---------------------------------------------------------------------------------------------
section "2. Second deployment: new files updated, old assets preserved"
mkdist "$T/dB" "buildB" BBBBBBBB
cp -p "$W/assets/index-AAAAAAAA.js" "$T/oldA.js"
rc=$(run "$T/dB" "$W"); check "exits 0" "[ $rc = 0 ]"
check "index.html + version.json + sw.js + manifest.json now the new build" "cmp -s $T/dB/index.html $W/index.html && cmp -s $T/dB/version.json $W/version.json && cmp -s $T/dB/sw.js $W/sw.js && cmp -s $T/dB/manifest.json $W/manifest.json"
check "old build's assets still present and byte-identical (a stale page keeps working)" "cmp -s $T/oldA.js $W/assets/index-AAAAAAAA.js && [ -f $W/assets/index-AAAAAAAA.css ]"
check "new build's assets present" "[ -f $W/assets/index-BBBBBBBB.js ] && [ -f $W/assets/index-BBBBBBBB.css ]"

# ---------------------------------------------------------------------------------------------
section "3. Unchanged fingerprinted assets are not rewritten (no truncation window)"
mkdist "$T/dB2" "buildB2" BBBBBBBB                      # same asset name AND content as build B
cp -p "$T/dB/assets/index-BBBBBBBB.js" "$T/dB2/assets/index-BBBBBBBB.js"; cp -p "$T/dB/assets/index-BBBBBBBB.css" "$T/dB2/assets/index-BBBBBBBB.css"
before=$(stat -c %i "$W/assets/index-BBBBBBBB.js")
rc=$(run "$T/dB2" "$W"); after=$(stat -c %i "$W/assets/index-BBBBBBBB.js")
check "publish succeeds and the identical asset keeps its inode (was not re-written)" "[ $rc = 0 ] && [ $before = $after ]"
check "version.json updated to the new build id" "grep -q buildB2 $W/version.json"

# ---------------------------------------------------------------------------------------------
section "4. Everything else in the web root is preserved (uploads, symlinks, dotfiles, other files)"
W4="$T/www4/zteam"; mkdist "$T/d4a" "b4a" CCCCCCCC; run "$T/d4a" "$W4" >/dev/null
mkdir -p "$W4/uploads/2026" "$W4/.well-known" "$W4/api" "$W4/socket.io" "$T/outside"
echo "photo" >"$W4/uploads/2026/photo.png"; echo "acme" >"$W4/.well-known/acme-challenge"; echo "User-agent: *" >"$W4/robots.txt"
echo "keep me" >"$T/outside/data.txt"; ln -s "$T/outside" "$W4/data-link"; echo "stub" >"$W4/api/x"; echo "stub" >"$W4/socket.io/x"
touch -d "40 days ago" "$W4/uploads/2026/photo.png" "$W4/robots.txt" "$W4/api/x"
snap_before=$(snapshot "$W4" | grep -v -E 'assets|index.html|version.json|sw.js|manifest.json|icon.png')
mkdist "$T/d4b" "b4b" DDDDDDDD; rc=$(run "$T/d4b" "$W4")
snap_after=$(snapshot "$W4" | grep -v -E 'assets|index.html|version.json|sw.js|manifest.json|icon.png')
check "publish succeeds" "[ $rc = 0 ]"
check "uploads/, .well-known/, robots.txt, api/, socket.io/, symlink are byte-for-byte unchanged" "[ \"\$snap_before\" = \"\$snap_after\" ]"
check "symlink target outside the web root untouched" "[ \"\$(cat $T/outside/data.txt)\" = 'keep me' ] && [ -L $W4/data-link ]"

# ---------------------------------------------------------------------------------------------
section "5. Retention: only expired, unreferenced, fingerprinted assets are deleted"
W5="$T/www5/zteam"; mkdist "$T/d5a" "b5a" EEEEEEEE; run "$T/d5a" "$W5" >/dev/null
A="$W5/assets"
echo x >"$A/index-OLDOLD01.js";  touch -d "15 days ago" "$A/index-OLDOLD01.js"       # expired, unreferenced  -> delete
echo x >"$A/vendor-OLDOLD02.css"; touch -d "30 days ago" "$A/vendor-OLDOLD02.css"      # expired, unreferenced  -> delete
echo x >"$A/index-RECENT03.js";  touch -d "13 days ago" "$A/index-RECENT03.js"         # not yet expired       -> keep
echo x >"$A/notes.txt";          touch -d "90 days ago" "$A/notes.txt"                 # not fingerprinted     -> keep
echo x >"$A/.hidden-OLDOLD04.js"; touch -d "90 days ago" "$A/.hidden-OLDOLD04.js"      # dotfile               -> keep
mkdir -p "$A/sub"; echo x >"$A/sub/deep-OLDOLD05.js"; touch -d "90 days ago" "$A/sub/deep-OLDOLD05.js"   # nested, expired -> delete (still a fingerprinted build file)
ln -s "$T/outside/data.txt" "$A/link-OLDOLD06.js"                                      # symlink               -> keep
touch -d "30 days ago" "$W5/robots.txt" 2>/dev/null; echo r >"$W5/robots.txt"; touch -d "90 days ago" "$W5/robots.txt"   # outside assets/ -> keep
# the NEXT build re-uses an asset that is 20 days old on disk: it is referenced, so it must survive
mkdist "$T/d5b" "b5b" EEEEEEEE; touch -d "20 days ago" "$A/index-EEEEEEEE.js" "$A/index-EEEEEEEE.css"
rc=$(run "$T/d5b" "$W5")
check "publish succeeds" "[ $rc = 0 ]"
check "expired + unreferenced fingerprinted assets removed" "[ ! -e $A/index-OLDOLD01.js ] && [ ! -e $A/vendor-OLDOLD02.css ] && [ ! -e $A/sub/deep-OLDOLD05.js ]"
check "13-day-old asset kept (inside the 14-day window)" "[ -f $A/index-RECENT03.js ]"
check "an old-on-disk asset that the CURRENT build references is kept (and refreshed)" "[ -f $A/index-EEEEEEEE.js ] && [ -n \"\$(find $A/index-EEEEEEEE.js -mmin -5)\" ]"
check "non-fingerprinted files, dotfiles, symlinks and files outside assets/ are never deleted" "[ -f $A/notes.txt ] && [ -f $A/.hidden-OLDOLD04.js ] && [ -L $A/link-OLDOLD06.js ] && [ -f $W5/robots.txt ]"
echo x >"$A/.index-ZZZZZZZZ.js.new.4242"; touch -d "2 days ago" "$A/.index-ZZZZZZZZ.js.new.4242"; echo x >"$A/.index-YYYYYYYY.js.new.4343"   # temp files of a SIGKILLed publish
rc=$(run "$T/d5b" "$W5")
check "temp files left by a killed publish: removed when >1 day old, kept when fresh" "[ $rc = 0 ] && [ ! -e $A/.index-ZZZZZZZZ.js.new.4242 ] && [ -e $A/.index-YYYYYYYY.js.new.4343 ]"
check "retention is configurable (1 day): the 13-day-old asset is now removed" "[ $(run "$T/d5b" "$W5" 1) = 0 ] && [ ! -e $A/index-RECENT03.js ] && [ -f $A/index-EEEEEEEE.js ]"

# ---------------------------------------------------------------------------------------------
section "6. Pre-flight checks abort BEFORE the web root is touched"
W6="$T/www6/zteam"; mkdist "$T/d6a" "b6a" FFFFFFFF; run "$T/d6a" "$W6" >/dev/null
good=$(snapshot "$W6")
expect_abort() {   # <label> <dist>
  local rc; rc=$(run "$2" "$W6")
  check "$1 -> refused (exit != 0) and web root byte-for-byte unchanged" "[ $rc != 0 ] && [ \"\$good\" = \"\$(snapshot $W6)\" ]"
}
mkdist "$T/e1" "bad1" GGGGGGGG; rm "$T/e1/version.json";             expect_abort "missing version.json" "$T/e1"
mkdist "$T/e2" "bad2" GGGGGGGG; rm "$T/e2/index.html";               expect_abort "missing index.html" "$T/e2"
mkdist "$T/e3" "bad3" GGGGGGGG; rm -rf "$T/e3/assets"/*;             expect_abort "empty assets/" "$T/e3"
mkdist "$T/e4" "bad4" GGGGGGGG; rm "$T/e4/assets/index-GGGGGGGG.js"; expect_abort "index.html references a missing asset" "$T/e4"
mkdist "$T/e5" "bad5" GGGGGGGG; sed -i 's#"/assets/#"./assets/#g' "$T/e5/index.html"; expect_abort "relative './assets' paths (the blank-page-on-reload bug)" "$T/e5"
mkdist "$T/e6" "bad6" GGGGGGGG; head -c 40 "$T/e6/index.html" >"$T/e6/x" && mv "$T/e6/x" "$T/e6/index.html"; expect_abort "truncated index.html" "$T/e6"
mkdist "$T/e7" "bad7" GGGGGGGG; echo '{}' >"$T/e7/version.json";    expect_abort "version.json without a build id" "$T/e7"

# ---------------------------------------------------------------------------------------------
section "7. Unsafe web-root arguments are refused"
if [ -n "${SKIP_UNSAFE_ROOT_TESTS:-}" ]; then echo "  (skipped)"; else
for bad_root in "/" "//" "/tmp" "/var" "/var/www" "relative/path" "." ""; do
  rc=$(run "$T/dA" "$bad_root"); check "web root '$bad_root' refused" "[ $rc != 0 ]"
done
echo notadir >"$T/afile"; rc=$(run "$T/dA" "$T/afile"); check "web root that is a regular file refused" "[ $rc != 0 ]"
rc=$(run "$T/dA" "$T/dA"); check "web root == dist directory refused" "[ $rc != 0 ]"
rc=$(bash "$PUBLISH" "$T/dA" "$T/www7/zteam" abc >/dev/null 2>&1; echo $?); check "non-numeric retention refused" "[ $rc != 0 ]"
fi

# ---------------------------------------------------------------------------------------------
section "8. Partial failure: previous site stays intact and consistent"
# fake cp / mv that fail ONCE when an argument contains $FAIL_PATTERN
SHIM="$T/shim"; mkdir -p "$SHIM"
for cmd in cp mv; do
  real=$(command -v $cmd)
  cat >"$SHIM/$cmd" <<EOF
#!/bin/bash
if [ "\${FAIL_CMD:-}" = "$cmd" ] && [ -n "\${FAIL_PATTERN:-}" ] && [ ! -e "\$FAIL_FLAG" ]; then
  for a in "\$@"; do case "\$a" in *\$FAIL_PATTERN*) : >"\$FAIL_FLAG"; echo "shim: injected $cmd failure on \$a" >&2; exit 1;; esac; done
fi
exec $real "\$@"
EOF
  chmod +x "$SHIM/$cmd"
done
fail_case() {   # <label> <cmd> <pattern>
  local W8="$T/www8-$RANDOM/zteam" rc
  mkdist "$T/f1" "good-old" HHHHHHHH; run "$T/f1" "$W8" >/dev/null
  mkdist "$T/f2" "good-new" IIIIIIII
  local before; before=$(snapshot "$W8" | grep -v '/assets/')
  rc=$(FAIL_CMD=$2 FAIL_PATTERN=$3 FAIL_FLAG="$T/flag-$RANDOM" PATH="$SHIM:$PATH" bash "$PUBLISH" "$T/f2" "$W8" >"$T/out.log" 2>&1; echo $?)
  check "$1: publish exits non-zero" "[ $rc != 0 ] && grep -q 'injected' $T/out.log"
  check "$1: index.html, version.json, sw.js, manifest.json all rolled back to the previous build" "[ \"\$before\" = \"\$(snapshot $W8 | grep -v '/assets/')\" ] && grep -q good-old $W8/version.json"
  check "$1: previous build's assets intact (site still works)" "[ -f $W8/assets/index-HHHHHHHH.js ] && [ -f $W8/assets/index-HHHHHHHH.css ]"
  check "$1: no temp/backup files left behind" "[ -z \"\$(find $W8 -name '.*.new.*' -o -name '.*.restore.*')\" ]"
  check "$1: the previous index.html's assets all exist" "! grep -oE '/assets/[A-Za-z0-9._-]+' $W8/index.html | while read r; do [ -f $W8\$r ] || echo missing; done | grep -q missing"
}
fail_case "copying an asset fails"                      cp ".index-IIIIIIII.js.new"
fail_case "writing sw.js fails (after assets, before index)" mv ".sw.js.new"
fail_case "writing index.html fails"                    cp ".index.html.new"
fail_case "writing version.json fails (AFTER index.html was switched)" mv ".version.json.new"
# first-ever deployment failing leaves no half-published entry files
W8b="$T/www8b/zteam"; mkdist "$T/f3" "first" JJJJJJJJ
rc=$(FAIL_CMD=mv FAIL_PATTERN=".version.json.new" FAIL_FLAG="$T/flagF" PATH="$SHIM:$PATH" bash "$PUBLISH" "$T/f3" "$W8b" >"$T/out.log" 2>&1; echo $?)
check "first deployment failing: non-zero, and no index.html/version.json/sw.js/manifest.json left half-published" "[ $rc != 0 ] && [ ! -e $W8b/index.html ] && [ ! -e $W8b/version.json ] && [ ! -e $W8b/sw.js ] && [ ! -e $W8b/manifest.json ]"
# interrupted by a signal
W8c="$T/www8c/zteam"; mkdist "$T/f4" "sig-old" KKKKKKKK; run "$T/f4" "$W8c" >/dev/null; mkdist "$T/f5" "sig-new" LLLLLLLL
for i in $(seq 1 120); do printf 'x%s' "$i" >"$T/f5/assets/big-$i-ABCDEFGH.js"; done
bash "$PUBLISH" "$T/f5" "$W8c" >/dev/null 2>&1 & pid=$!; sleep 0.01; kill -TERM $pid 2>/dev/null; wait $pid 2>/dev/null
check "SIGTERM mid-publish: web root is either the complete old build or the complete new build (never mixed)" "( grep -q sig-old $W8c/version.json && grep -q sig-old $W8c/index.html ) || ( grep -q sig-new $W8c/version.json && grep -q sig-new $W8c/index.html )"
W8d="$T/www8d/zteam"; run "$T/f4" "$W8d" >/dev/null
bash "$PUBLISH" "$T/f5" "$W8d" >/dev/null 2>&1 & pid=$!; sleep 0.01; kill -HUP $pid 2>/dev/null; wait $pid 2>/dev/null
check "SIGHUP mid-publish (dropped SSH session / cancelled deploy): never a mixed state, no temp files" "( grep -q sig-old $W8d/version.json && grep -q sig-old $W8d/index.html ) || ( grep -q sig-new $W8d/version.json && grep -q sig-new $W8d/index.html )"
check "SIGHUP mid-publish: no temp files left" "[ -z \"\$(find $W8d -name '.*.new.*' -o -name '.*.restore.*')\" ]"
check "SIGTERM mid-publish: no temp files left" "[ -z \"\$(find $W8c -name '.*.new.*' -o -name '.*.restore.*')\" ]"

# ---------------------------------------------------------------------------------------------
section "9. A visitor can never see a broken site WHILE a publish is running"
W9="$T/www9/zteam"; mkdist "$T/g1" "live-old" MMMMMMMM; run "$T/g1" "$W9" >/dev/null
mkdist "$T/g2" "live-new" NNNNNNNN
for i in $(seq 1 400); do head -c 2000 /dev/urandom | base64 >"$T/g2/assets/chunk-$i-QRSTUVWX.js"; done
printf '' >"$T/viol"; printf '0' >"$T/iters"; touch "$T/reader-run"
( n=0; while [ -e "$T/reader-run" ]; do
    html=$(cat "$W9/index.html" 2>/dev/null) || { echo "index.html unreadable" >>"$T/viol"; continue; }
    case $html in *'</html>'*) ;; *) echo "partial/empty index.html" >>"$T/viol";; esac
    for r in $(printf '%s' "$html" | grep -oE '/assets/[A-Za-z0-9._-]+'); do [ -f "$W9$r" ] || echo "index references missing $r" >>"$T/viol"; done
    v=$(cat "$W9/version.json" 2>/dev/null); case $v in *'"build"'*) ;; *) echo "bad version.json" >>"$T/viol";; esac
    n=$((n + 1)); printf '%s' "$n" >"$T/iters"
  done ) & reader=$!
sleep 0.3; rc=$(run "$T/g2" "$W9"); sleep 0.3; rm -f "$T/reader-run"; wait $reader 2>/dev/null
iters=$(cat "$T/iters")
check "publish of 801 files succeeded" "[ $rc = 0 ]"
check "reader polled the live site $iters times during the publish (>=50)" "[ $iters -ge 50 ]"
check "zero broken states observed (no missing asset, no partial index.html, no bad version.json)" "[ ! -s $T/viol ]"
[ -s "$T/viol" ] && sort "$T/viol" | uniq -c | head -5

# ---------------------------------------------------------------------------------------------
section "10. Idempotent and concurrency-safe"
W10="$T/www10/zteam"; mkdist "$T/h1" "idem" OOOOOOOO
check "deploying the same build twice succeeds both times" "[ $(run "$T/h1" "$W10") = 0 ] && [ $(run "$T/h1" "$W10") = 0 ] && cmp -s $T/h1/index.html $W10/index.html"
if command -v flock >/dev/null 2>&1; then
  mkdist "$T/h2" "conc" PPPPPPPP; for i in $(seq 1 150); do head -c 4000 /dev/urandom | base64 >"$T/h2/assets/c-$i-ABCDEFGH.js"; done
  ( bash "$PUBLISH" "$T/h2" "$W10" >"$T/c1.log" 2>&1 ) & p1=$!; sleep 0.05
  rc2=$(run "$T/h2" "$W10"); wait $p1
  check "a second publish started while one is running is refused cleanly (or finishes safely)" "[ $rc2 != 0 ] && grep -q 'already running' $T/out.log || { [ $rc2 = 0 ] && cmp -s $T/h2/index.html $W10/index.html; }"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
