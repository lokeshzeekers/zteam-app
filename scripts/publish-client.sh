#!/usr/bin/env bash
# publish-client.sh - publish a built Zteam web client into the nginx web root, safely.
#
#   Usage: publish-client.sh <dist-dir> <web-root> [retention-days=14]
#
# Guarantees
#   * Nothing in the web root is ever bulk-deleted. The ONLY deletions are expired, unreferenced,
#     fingerprinted files inside <web-root>/assets (see cleanup_old_assets). Anything else that lives
#     in the web root (uploads, .well-known, robots.txt, symlinks, ...) is never touched.
#   * Old fingerprinted assets are kept for <retention-days> after they stop being part of the
#     current build, so an app or tab still holding the previous index.html keeps working.
#   * Every file is written to a temp file and renamed into place (atomic), and the files that make
#     a new build "visible" are switched LAST: assets -> other static files -> sw.js, manifest.json
#     -> index.html -> version.json. A visitor can therefore never load an index.html whose assets
#     are not there yet, and never sees a half-written file.
#   * Pre-flight checks run before the web root is touched; a post-publish check runs afterwards.
#     On any failure the previous index.html / version.json / sw.js / manifest.json are restored.
#   * API, Socket.IO and uploaded data are not part of the web root and are never touched.
set -Eeuo pipefail

log() { printf '[publish] %s\n' "$*"; }
die() { printf '[publish] ERROR: %s\n' "$*" >&2; exit 1; }
usage() { echo "Usage: $0 <dist-dir> <web-root> [retention-days=14]" >&2; exit 2; }

[ $# -ge 2 ] && [ $# -le 3 ] || usage
DIST_IN=$1
WEBROOT_IN=$2
DAYS=${3:-14}

# ---------------------------------------------------------------- argument validation
case $DAYS in ''|*[!0-9]*) die "retention-days must be a whole number (got '$DAYS')";; esac
[ "$DAYS" -ge 1 ] || die "retention-days must be at least 1"

[ -d "$DIST_IN" ] || die "dist directory not found: $DIST_IN"
DIST=$(cd "$DIST_IN" && pwd -P)

[ -n "$WEBROOT_IN" ] || die "web root is empty"
case $WEBROOT_IN in /*) ;; *) die "web root must be an absolute path (got '$WEBROOT_IN')";; esac
WEBROOT=$(realpath -m -- "$WEBROOT_IN")
# at least three components, e.g. /var/www/zteam - never "/", "/var", "/var/www", "/tmp" ...
slashes=$(printf '%s' "$WEBROOT" | tr -cd '/' | wc -c)
{ [ "$WEBROOT" != "/" ] && [ "$slashes" -ge 3 ]; } || die "refusing unsafe web root '$WEBROOT' (need an absolute path at least three levels deep, e.g. /var/www/zteam)"
{ [ ! -e "$WEBROOT" ] || [ -d "$WEBROOT" ]; } || die "$WEBROOT exists but is not a directory"
[ "$WEBROOT" != "$DIST" ] || die "web root and dist directory are the same"

# ---------------------------------------------------------------- pre-flight (web root untouched so far)
for f in index.html version.json; do
  [ -s "$DIST/$f" ] || die "build is incomplete: $DIST/$f is missing or empty"
done
[ -d "$DIST/assets" ] || die "build is incomplete: $DIST/assets is missing"
[ -n "$(find "$DIST/assets" -type f -print -quit)" ] || die "build is incomplete: $DIST/assets has no files"
grep -q '</html>' "$DIST/index.html" || die "index.html looks truncated"
if grep -Eq '(src|href)="\./' "$DIST/index.html"; then
  die "index.html uses relative asset paths ('./'); a reload on /chat/6 would break. Build with base '/'"
fi
grep -Eq '"build"[[:space:]]*:[[:space:]]*"[^"]+"' "$DIST/version.json" || die "version.json has no build id"
REFS=$(grep -oE '/assets/[A-Za-z0-9._-]+' "$DIST/index.html" | sort -u || true)
[ -n "$REFS" ] || die "index.html references no /assets files"
while IFS= read -r ref; do
  [ -f "$DIST$ref" ] || die "index.html references $ref, which is not in the build"
done <<<"$REFS"

# ---------------------------------------------------------------- lock (one publish at a time)
if command -v flock >/dev/null 2>&1; then
  lockname=$(printf '%s' "$WEBROOT" | cksum | cut -d' ' -f1)
  exec 9>"${TMPDIR:-/tmp}/zteam-publish-$lockname.lock"
  flock -n 9 || die "another publish to $WEBROOT is already running"
fi

# ---------------------------------------------------------------- state, atomic install, rollback
ENTRY_FILES=(sw.js manifest.json index.html version.json)   # order matters: index.html, then version.json LAST
BACKUP=$(mktemp -d "${TMPDIR:-/tmp}/zteam-publish.XXXXXX")
TEMPS=()
INSTALLED=()
DONE=0
declare -A CURRENT=()

atomic_install() {   # atomic_install <source> <destination>
  local src=$1 dest=$2 dir base tmp
  dir=$(dirname -- "$dest"); base=$(basename -- "$dest")
  mkdir -p -- "$dir"
  tmp="$dir/.$base.new.$$"
  TEMPS+=("$tmp")
  cp -p -- "$src" "$tmp"
  mv -f -- "$tmp" "$dest"
}

# Remember the current version of a non-asset file BEFORE it is replaced, so it can be restored.
track_install() {   # track_install <path relative to the web root>
  local rel=$1
  if [ -f "$WEBROOT/$rel" ] && [ ! -e "$BACKUP/$rel" ]; then
    mkdir -p -- "$(dirname -- "$BACKUP/$rel")"
    cp -p -- "$WEBROOT/$rel" "$BACKUP/$rel"
  fi
  INSTALLED+=("$rel")                      # recorded BEFORE installing so a half-finished install is rolled back too
}

rollback() {
  set +e
  local i f tmp
  for ((i = ${#INSTALLED[@]} - 1; i >= 0; i--)); do   # newest first: version.json, index.html, manifest, sw.js, icons...
    f=${INSTALLED[$i]}
    [ -n "$f" ] || continue
    if [ -f "$BACKUP/$f" ]; then
      tmp="$(dirname -- "$WEBROOT/$f")/.$(basename -- "$f").restore.$$"
      TEMPS+=("$tmp")
      if cp -p -- "$BACKUP/$f" "$tmp" && mv -f -- "$tmp" "$WEBROOT/$f"; then
        log "restored previous $f"
      else
        log "WARNING: could not restore previous $f (a copy is in $BACKUP)"; KEEP_BACKUP=1
      fi
    else
      rm -f -- "$WEBROOT/$f" && log "removed $f (it did not exist before this publish)"
    fi
  done
}

KEEP_BACKUP=0
on_exit() {
  local code=$?
  trap - EXIT
  if [ "$DONE" -ne 1 ]; then
    log "FAILED (exit $code): rolling back index.html/version.json/sw.js/manifest.json and other static files; existing assets were not touched"
    rollback
  fi
  local t
  for t in "${TEMPS[@]:-}"; do [ -n "$t" ] && rm -f -- "$t"; done
  [ "$KEEP_BACKUP" -eq 1 ] || rm -rf -- "$BACKUP"
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP      # SSH session dropped / deploy run cancelled

same_file() { [ -f "$2" ] && cmp -s -- "$1" "$2"; }

# ---------------------------------------------------------------- 0. make sure the web root exists
mkdir -p -- "$WEBROOT"

# ---------------------------------------------------------------- 1. fingerprinted assets (additive)
mkdir -p -- "$WEBROOT/assets"
added=0; unchanged=0
while IFS= read -r -d '' src; do
  rel=${src#"$DIST/"}
  dest="$WEBROOT/$rel"
  if same_file "$src" "$dest"; then
    unchanged=$((unchanged + 1))          # identical file already there: never rewrite it (no truncation window)
  else
    atomic_install "$src" "$dest"
    added=$((added + 1))
  fi
  touch -- "$dest"                        # retention counts from the last build this file was part of
  CURRENT["$rel"]=1
done < <(find "$DIST/assets" -type f -print0)
log "assets: $added new, $unchanged unchanged"

# ---------------------------------------------------------------- 2. other static files (icons, ...)
other=0
while IFS= read -r -d '' src; do
  rel=${src#"$DIST/"}
  case $rel in assets/*) continue;; esac
  is_entry=0
  for f in "${ENTRY_FILES[@]}"; do [ "$rel" = "$f" ] && is_entry=1; done
  [ "$is_entry" -eq 0 ] || continue
  if ! same_file "$src" "$WEBROOT/$rel"; then
    track_install "$rel"
    atomic_install "$src" "$WEBROOT/$rel"
    other=$((other + 1))
  fi
done < <(find "$DIST" -type f -print0)
log "other static files updated: $other"

# ---------------------------------------------------------------- 3. entry files, in order
for f in "${ENTRY_FILES[@]}"; do
  if [ -f "$DIST/$f" ]; then
    track_install "$f"
    atomic_install "$DIST/$f" "$WEBROOT/$f"
    log "published $f"
  else
    log "note: $f is not part of this build (left as is)"
  fi
done

# ---------------------------------------------------------------- 4. verify what is now live
for f in "${ENTRY_FILES[@]}"; do
  [ -f "$DIST/$f" ] || continue
  cmp -s -- "$DIST/$f" "$WEBROOT/$f" || die "verification failed: $WEBROOT/$f does not match the build"
done
while IFS= read -r ref; do
  [ -n "$ref" ] || continue
  [ -f "$WEBROOT$ref" ] || die "verification failed: published index.html references $ref, which is missing in $WEBROOT"
done <<<"$(grep -oE '/assets/[A-Za-z0-9._-]+' "$WEBROOT/index.html" | sort -u || true)"
DONE=1       # the new build is live and consistent; from here on nothing is rolled back
log "build $(grep -oE '"build"[[:space:]]*:[[:space:]]*"[^"]+"' "$WEBROOT/version.json" | cut -d'"' -f4) is live"

# ---------------------------------------------------------------- 5. expire old assets (never fails the publish)
cleanup_old_assets() {
  local minutes=$((DAYS * 24 * 60)) f rel name removed=0 skipped=0
  while IFS= read -r -d '' f; do
    rel=${f#"$WEBROOT/"}
    name=$(basename -- "$f")
    [ -z "${CURRENT[$rel]:-}" ] || continue                                    # part of the current build
    case $name in .*) continue;; esac                                           # never touch dotfiles
    [[ $name =~ -[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$ ]] || { skipped=$((skipped + 1)); continue; }   # not a fingerprinted build file
    if rm -f -- "$f"; then log "removed expired asset: $rel"; removed=$((removed + 1)); fi
  done < <(find "$WEBROOT/assets" -type f -mmin "+$minutes" -print0)
  log "retention ${DAYS}d: $removed expired asset(s) removed, $skipped non-fingerprinted file(s) left alone"
}
# Temp files only this script creates (left behind only if it was SIGKILLed): remove once a day old.
cleanup_stale_temps() {
  local f n=0
  while IFS= read -r -d '' f; do rm -f -- "$f" && n=$((n + 1)); done < <(find "$WEBROOT" -type f \( -name '.*.new.[0-9]*' -o -name '.*.restore.[0-9]*' \) -mmin +1440 -print0)
  [ "$n" -eq 0 ] || log "removed $n stale temp file(s) from an interrupted publish"
}
cleanup_stale_temps || true
cleanup_old_assets || log "WARNING: old-asset cleanup failed (the publish itself succeeded)"
log "done"
