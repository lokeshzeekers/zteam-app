# Zteam deployment architecture

**One source of truth: the live website on the VPS.** The Windows app and the Android app are thin
native shells that open `https://zteam.zeekerstech.com`. Everything else (UI, frontend, backend,
sessions, chat, meetings) is served by the VPS, so a normal deployment reaches every installed app
without a new installer.

```
 push to main ──► GitHub Actions "Deploy Zteam to VPS"
                    git pull → npm ci → vite build → copy dist to /var/www/zteam
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
   point at deleted files.

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
