# Zteam deployment architecture

**One source of truth: the live website on the VPS.** The Windows app and the Android app are thin
native shells that open `https://zteam.zeekerstech.com`. Everything else (UI, frontend, backend,
sessions, chat, meetings) is served by the VPS, so a normal deployment reaches every installed app
without a new installer.

```
 push to main ──► GitHub Actions "Deploy Zteam to VPS"
                    git pull → npm ci → vite build → scripts/publish-client.sh dist → /var/www/zteam
                    (old /assets kept 14 days) → pm2 restart zteam-server → /api/health

 Windows EXE  (electron/main.js)  ──loadURL──►  https://zteam.zeekerstech.com  ◄──  Android APK (Capacitor server.url)
        │ clears HTTP cache on every launch                                          │ WebView, no bundled web app
        └ native bridge window.zteamDesktop (preload.js)                             └ camera / mic / internet permissions
```

## What reaches installed apps, and how

| Change | Windows EXE / Android APK | Needs a new installer? |
|---|---|---|
| Website UI / frontend | EXE: on every launch and on refresh. Both: a running app notices the new build (`/version.json`) and reloads itself when it is safe (see below) | No |
| Backend / API / database | Immediately (same server) | No |
| Native shell (tray, badge, notification bridge, permissions, new Android plugin) | EXE: auto-updater (GitHub Release `v*.*.*`). APK: install the new APK | **Yes** |

### Automatic pickup of a new deployment (client `UpdateBanner`)
Each build publishes `/version.json` (`{"build": "..."}`) and embeds the same id in the JS bundle.
The app compares them: shortly after launch, every 5 minutes, when it returns to the foreground and
when the network comes back.
- Build differs, app just opened (first 30 s) → reload immediately.
- Build differs, app brought to the foreground → reload, **unless** a call is ringing/active or an
  unsent message is being typed → then a "New version available · Reload" bar is shown instead.
- One automatic reload per new build (no reload loops). The meeting room page never auto-reloads.

## Required server configuration (nginx on the VPS)

The repo cannot configure nginx, so this must be applied once on the VPS. Without it, an app that
holds an older page **can show it for hours after a deployment** (browsers may reuse a response that
has no `Cache-Control` for ~10 % of its age). Tested: see "Evidence" below.

```nginx
# inside the server { } block for zteam.zeekerstech.com
root /var/www/zteam;
index index.html;

location = /index.html    { add_header Cache-Control "no-cache"; }
location = /version.json  { add_header Cache-Control "no-cache"; }
location = /sw.js         { add_header Cache-Control "no-cache"; }
location = /manifest.json { add_header Cache-Control "no-cache"; }
location /assets/         { add_header Cache-Control "public, max-age=31536000, immutable"; try_files $uri =404; }
location /                { add_header Cache-Control "no-cache"; try_files $uri $uri/ /index.html; }
# plus your existing /api and /socket.io proxy locations
```
Then: `sudo nginx -t && sudo systemctl reload nginx`, and verify with

```bash
scripts/verify-deployment.sh https://zteam.zeekerstech.com
```
(checks entry-file cache headers, version.json, asset paths/MIME types, deep-link reload, `/api/health`).
Run it after every nginx change and whenever a "blank page after reload" is reported.

## Publishing the client (`scripts/publish-client.sh <dist> <web-root> [days=14]`)

The web root is **never bulk-deleted**. The deploy used to run `rm -rf /var/www/zteam/*` before copying,
which removed every previous asset (and anything else in that directory). The script replaces it:

1. **Pre-flight, before the web root is touched:** `index.html`, `version.json` (with a build id) and
   non-empty `assets/` exist; `index.html` is complete, uses absolute `/assets/...` paths and references
   only files that are in the build. The web root must be an absolute path at least three levels deep.
2. **Assets are additive:** new fingerprinted files are copied in; identical files are left untouched
   (never rewritten, so no truncation window); every asset of the current build gets a fresh timestamp.
3. **Switch order:** assets → other static files → `sw.js`, `manifest.json` → `index.html` →
   `version.json` last. Every file is written to a temp file and renamed into place (atomic). A visitor
   never gets an `index.html` whose assets are missing.
4. **Verify and roll back:** afterwards every entry file must match the build and every asset referenced
   by the live `index.html` must exist. On any failure, or on SIGINT/SIGTERM/SIGHUP (e.g. a cancelled
   deploy run), `index.html`, `version.json`, `sw.js`, `manifest.json` and any replaced static file are
   restored. A failing publish stops the deploy before the backend restart, so site and API stay consistent.
5. **Retention:** only files inside `assets/` that are (a) older than 14 days since they were last part of
   a build, (b) not referenced by the current build and (c) fingerprinted (`name-HASH.ext`) are removed.
   Dotfiles, symlinks, non-fingerprinted files and everything outside `assets/` are never deleted.
6. **Out of scope by design:** API, Socket.IO and uploaded files (`UPLOAD_DIR`, served by Express) are not
   part of the web root and are never touched; even if `UPLOAD_DIR` were placed inside the web root, the
   script cannot delete it.

Run `scripts/test-publish-client.sh` (68 checks; also a CI job, together with ShellCheck) after any change.

## Rules that keep old installed apps working

1. **Never load the web app from inside the installer.** `electron/client-dist` was removed; the
   desktop app only calls `loadURL`. The APK contains only a 384-byte placeholder page.
2. **Keep `window.zteamDesktop` backward compatible** (`notify`, `closeNotification`, `flash`,
   `clearFlash`). Installed EXEs keep the preload they were built with. Only *add* functions, and
   feature-detect them in the website (`window.zteamDesktop?.newThing?.()`).
3. **Keep API changes additive.** Pages that are already open keep calling the old endpoints until
   they reload. For a breaking API change: deploy the compatible server first, then the new client.
4. The website must use **absolute asset paths** (`base: '/'` in `client/vite.config.js`); relative
   paths make a reload on `/chat/6` request `/chat/assets/...` and show a blank page.
5. The deploy keeps the previous build's `/assets` for 14 days so a not-yet-refreshed page does not
   point at deleted files (see "Publishing the client").

## Known limitations

- **Android push notifications.** The Android WebView has no web Notification API, so alerts appear
  only while the app is open. Background push needs Firebase Cloud Messaging, a native plugin and a
  new APK (not implemented). The desktop app is unaffected (native notifications via the bridge).
- **Pages without the update checker.** Sessions that loaded a build from before `UpdateBanner`
  existed cannot self-update once; they pick up the new site on the next launch/refresh (EXE) or when
  their cached page expires (APK, see nginx above). From then on updates are automatic.
- **Offline at launch.** The desktop app has no offline/retry page: if the server is unreachable when
  it starts the window stays blank until relaunch. The APK shows the Capacitor error page.
- **The APK is debug-signed** (permanent key stored as repo secret `ANDROID_DEBUG_KEYSTORE_B64`); it
  is installable by sideloading, not publishable to the Play Store as is. APK shell updates are manual.
- **Electron hardening not changed:** no permission handler (Electron grants camera/mic by default)
  and no navigation allow-list. Working as intended today; harden separately if needed.

## Evidence (how this was tested)

Run on a Linux sandbox; a "VPS" was simulated by a local server using the same publish commands as
`deploy-vps.yml`, with three consecutive website versions (v1 = site before this change, no update
checker; v2 and v3 = with it).

**Windows shell — the real Electron 31 runtime running the repo's unmodified `main.js` + `preload.js`,
one profile, never reinstalled (13/13 checks):** loads the live URL; `window.zteamDesktop` exposed on
the remote site; login, chat send (REST + socket), notification/flash IPC and WebRTC/getUserMedia
availability work; v2 deployed → F5 shows v2; closing and reopening the app shows v2 **still logged
in with chat history intact**; v3 deployed while open → with a draft being typed the app keeps the
draft and shows the update bar, once the draft is cleared it reloads to v3 by itself.

**Android shell — APK inspected, behaviour simulated in Chromium (not a device):** the released
`Zteam-1.0.9.apk` contains `server.url = https://zteam.zeekerstech.com` and only a placeholder page.
Reopening after a deployment (persistent profile, app launches at `/`; a control with an explicit
1-hour cache correctly showed the stale page, proving the test can detect staleness):

| Page the app holds | Server headers | Result after reopening |
|---|---|---|
| old page, no checker | stock nginx (no Cache-Control) | **stale — still the old version** |
| old page, no checker | `no-cache` on entry files | new version |
| new page (has checker) | stock nginx | old for a moment, then new within seconds |
| new page (has checker) | 1-hour max-age (misconfigured) | old for a moment, then new within seconds |

Not covered: a physical Windows/Android device, OS-level notification toasts, Windows taskbar
flash/badge, the NSIS auto-updater, and a real two-party call.

**Publish script (68 checks, `scripts/test-publish-client.sh`):** first and repeated deployments; old assets
kept byte-identical; unchanged assets not rewritten; uploads, dotfiles, symlinks and unrelated files
unchanged; retention (expired/unreferenced removed, 13-day-old and referenced kept, configurable); 7
broken builds refused with the web root unchanged, and 11 unsafe arguments (web roots like `/`, `/tmp`, `/var/www`, a file, the dist directory, a bad retention value) refused; injected failures while
copying an asset, `sw.js`, `index.html` and `version.json` (after `index.html` was switched), a first-ever
deployment, and SIGTERM/SIGHUP mid-publish all leave either the complete old or the complete new site and no
temp files; a reader polling the live site hundreds of times during an 801-file publish saw zero broken states.
The same suite run against the old logic fails 28 checks (the `rm -rf` version on `main`) and 19 checks
(the first version of this PR), so the tests do detect the problems they target.
