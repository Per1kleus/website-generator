# Packaging: Windows desktop app and Android client

The application is a Node server. All 44 of its routes are server-rendered, it
uses native modules (`better-sqlite3`, `sharp`) and it shells out to Python for
the design catalogue. There is no static export to drop into a webview, so
"make it downloadable" means deciding **where the server runs** — and the
honest answer is different on the two platforms.

| | Windows | Android |
| --- | --- | --- |
| Shape | Tauri shell + the real server as a sidecar | Capacitor client to a deployment |
| Server | On the user's own machine, loopback only | Wherever the operator runs it |
| User installs | Nothing else — Node ships inside | Nothing |
| Works offline | Yes | No, by definition |
| Google OAuth | System browser, loopback redirect, PKCE | Normal web flow on the server |

Windows gets the whole product. Android gets the same interface over the
network, because a phone cannot run a Node server with native modules and a
Python subprocess — pretending otherwise would mean a second, worse
implementation of every feature.

## What ships, and what does not

Nothing secret is in either artifact. This is a hard property, tested by
`npm run test:desktop`:

- The installer contains the compiled app, a Node runtime, an optional Python
  runtime, and an icon.
- The APK contains the web shell and, optionally, the **address** of the
  deployment it should open — an address, not a credential.
- `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET`, `WG_SECRET`, Vercel and Netlify
  tokens are never staged into a build. `scripts/build-desktop.mjs` copies
  three named things and deletes `data/` before bundling.
- The desktop OAuth client is a **Desktop app** client, which by design has no
  usable secret — so there is no secret to leak, rather than a secret that is
  hidden well.

On the desktop the user's own keys live in their profile, encrypted
(`%APPDATA%\app.websitegenerator.desktop\settings.enc`, AES-256-GCM), written from the
app's own Profile screen. They are never returned by any API: reading them back
gives "configured" and the last four characters. `/api/settings` answers 404 on
a hosted deployment, where environment variables belong to the operator and one
creator must not be able to rewrite them.

## For the person installing it

**Windows** — download the `.exe`, run it, open it from the Start menu. It
installs for the current user, so it needs no administrator rights. First
launch opens on `http://127.0.0.1:<port>`, bound to loopback only; nothing is
exposed to the network. Everything the app stores lives in `%APPDATA%`, and
uninstalling from Add or Remove Programs leaves it there so a reinstall keeps
your projects.

The app works immediately with no keys at all: it generates from your own
inputs using the design catalogue. Adding an Anthropic key on the Profile
screen turns on business research, written copy and translation. Adding a
Google client ID turns on digital menus from a Google Sheet.

**Android** — install the APK. If the build baked in a backend address it opens
straight into the app; otherwise the first screen asks for it once and
remembers it. The address must be `https://` — the build refuses anything else,
because a session cookie over plain http would be worse than not shipping.

## For a developer

```bash
# Windows installer  (run on Windows, with Rust + the Tauri prerequisites)
npm ci
npm run build:windows
#   → desktop/tauri/src-tauri/target/release/bundle/nsis/*.exe

# Stage everything without bundling — works anywhere, useful for inspection
npm run desktop:stage

# Run the desktop server exactly as the shell runs it, without the shell
npm run desktop:dev

# Android client (run on Linux/macOS/Windows with the Android SDK and JDK 21)
npm ci
WG_REMOTE_URL=https://your-deployment.example.com npm run build:android
#   → mobile/android/app/build/outputs/apk/debug/app-debug.apk
npm run build:android:release   # signed release APK
npm run build:android:bundle    # .aab for Play
```

CI does both: `.github/workflows/desktop-release.yml` builds the installer on
`windows-latest` and the APK on `ubuntu-latest`, on a `v*` tag or on demand.
`.github/workflows/ci.yml` runs the four QA suites on every push.

### Prerequisites the build assumes

- **Windows**: Rust (stable), the Tauri v2 prerequisites (Microsoft C++ Build
  Tools, WebView2 — present on Windows 11), Node 22.
- **Android**: JDK 21, the Android SDK, Node 22. `npx cap add android` creates
  the Gradle project on first run; it is generated, not committed.
- Optional on Windows: set `WG_PYTHON_DIR` to an embeddable Python
  distribution and it is bundled, so the design catalogue works without the
  user installing Python. Without it the app runs and the catalogue falls back
  exactly as it does on any machine without Python.


## One thing worth knowing about the staging step

Next externalises native modules under hashed names — `better-sqlite3-<hash>`,
`sharp-<hash>` — and stages them as **symlinks** in
`.next/standalone/.next/node_modules/`. Symlinks do not survive being bundled
into an installer: Tauri's resource copier drops them, and Windows will not
create one without a privilege. The installed app therefore started, served
`/api/health` happily, and then failed every page with `Cannot find module
'better-sqlite3-90e2652d1716b047'` — because only server-rendered pages pull
those externals in.

`scripts/build-desktop.mjs` now replaces each link with a two-line package that
requires the real one, and then refuses to continue if any symlink remains
anywhere in the staged tree. `npm run test:desktop` renders a real page and its
stylesheet through the packaged server, so an API-only pass can never again be
mistaken for a working build.

## Google Cloud configuration

Two OAuth clients, because the desktop and web flows are genuinely different
client types — not one client used two ways.

**Both**: in the Google Cloud console enable the **Google Sheets API** and the
**Google Drive API**, and on the OAuth consent screen add only the scopes the
app requests: `spreadsheets.readonly`, `drive.readonly`, `userinfo.email`.
Nothing is ever written to a user's Drive.

**Desktop app client** (for the Windows application)

- Credentials → Create credentials → OAuth client ID → **Desktop app**
- No redirect URI is configured: Google accepts any `http://127.0.0.1:<port>`
  callback for this client type, which is what makes an ephemeral loopback port
  workable.
- It issues a "client secret" that is explicitly not confidential. The app does
  not use it and does not ship it; the flow is protected by PKCE (S256)
  instead. Give users the **client ID only**.

**Web application client** (for a hosted deployment)

- Credentials → Create credentials → OAuth client ID → **Web application**
- Authorised redirect URI: `https://your-deployment.example.com/api/google/callback`
- Set both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the server.

The Android app needs no OAuth configuration of its own: it is a client to the
web deployment, so consent happens in the deployment's own browser flow under
the web client above.

### Deep links

None are required, and none are registered. The desktop callback lands on the
app's own loopback server, which renders a "you can close this tab" page — so
there is no custom URL scheme to hijack, and no
`com.googleusercontent.apps.*` handler another app could claim.

## Files added and changed

### Added

| File | Why |
| --- | --- |
| `src/server/runtime.ts` | One place that knows whether this process is a hosted server or a user's own machine, and the allowlist of configuration that may reach a client. |
| `src/server/settings.ts` | The desktop user has no terminal, so their own keys need a home: an encrypted file in their profile, write-only over the API, restricted to a four-key allowlist. |
| `src/instrumentation.ts` | Loads those settings into the environment once at startup, so every existing feature keeps reading `process.env` exactly as it does on a server. |
| `src/app/api/health/route.ts` | The shell needs to know when the bundled server is ready before it shows a window; also serves the public config. |
| `src/app/api/settings/route.ts` | Read status and save keys from inside the app. 404 on a hosted deployment. |
| `src/components/LocalSettingsCard.tsx` | The Profile-screen UI for the above. Rendered only in desktop mode. |
| `src/lib/shell.ts` | Detects whether the UI is inside Tauri, Capacitor or a browser, and opens external links the right way for each. |
| `src/components/NativeShell.tsx` | Android hardware back button, resume and deep-link handling — via the Capacitor window global, so the web bundle gains no dependency. |
| `desktop/sidecar/launch.mjs` | Boots the bundled server on a free loopback port and reports `WG_READY <url>` / `WG_FAILED <reason>`. Stops on SIGTERM or stdin close, so closing the window never leaves an orphaned server. |
| `desktop/tauri/**` | The Windows shell: window, splash, single-instance, sidecar lifecycle, NSIS bundle configuration, icons. |
| `mobile/capacitor.config.json`, `mobile/package.json`, `mobile/android-shell/src/index.html` | The Android client: config, its own toolchain, and the first-run screen that asks for the backend address. |
| `scripts/build-desktop.mjs` | Stages the standalone server, static assets, the Node runtime and optional Python, then bundles. Deletes `data/` so a developer's database is never shipped, replaces Next's native-module symlinks with real packages (see below), and refuses to bundle a tree that still contains a symlink. |
| `scripts/build-android.mjs` | Renders the shell with the backend address, creates and syncs the Capacitor project, runs Gradle. |
| `scripts/desktop-qa.mjs` | 36 checks over the parts of packaging that can be tested without Windows or a GUI. |
| `scripts/make-ico.mjs` | Generates the Windows icon set from the app icon. |
| `.github/workflows/ci.yml`, `.github/workflows/desktop-release.yml` | Tests on every push; real artifacts on the platforms that can build them. |

### Changed

| File | Why |
| --- | --- |
| `next.config.ts` | `output: "standalone"` — the sidecar needs a self-contained server, not a `node_modules` tree. |
| `src/server/google/oauth.ts` | Added PKCE (S256) and made the client secret optional in desktop mode, so a Desktop-app client works and no secret is needed anywhere near an installer. |
| `src/app/api/google/connect/route.ts` | On desktop, returns the consent URL for the system browser instead of navigating the app's own window — Google refuses consent inside embedded webviews. |
| `src/app/api/google/callback/route.ts` | On desktop, renders a self-contained "you can close this tab" page instead of redirecting, because the tab is not the application. |
| `src/app/layout.tsx` | Mounts `NativeShell`. |
| `src/app/account/page.tsx` | Shows the keys card on desktop and the "install on your phone" card everywhere else. |
| `src/components/MenuDataManager.tsx` | Opens Google consent in the system browser when running as a desktop app. |
| `src/server/uiux.ts` | Uses the configured Python interpreter, so a bundled runtime is found. |
| `scripts/mobile-qa.mjs`, `scripts/menu-data-qa.mjs` | Fall back to Playwright's own Chromium when this container's preinstalled one is absent, so the suites run on a CI runner too. |
| `scripts/mock-google.mjs` | Understands PKCE, so the desktop flow can be tested end to end. |
| `.gitignore` | Ignores the generated Android project, the staged web shell and the Tauri build outputs. |

## New dependencies

No new runtime dependency is added to the application itself.

- `mobile/package.json` (new, separate): `@capacitor/core`, `@capacitor/cli`,
  `@capacitor/android`, `@capacitor/app`, `@capacitor/browser`. Installed only
  when building the Android client.
- `desktop/tauri/src-tauri/Cargo.toml`: `tauri` v2 with the shell and
  single-instance plugins. Rust dependencies, resolved at build time on
  Windows.
- `@tauri-apps/cli` is installed with `--no-save` in CI rather than added to
  `devDependencies`, so `npm ci` stays fast for everyone not building an
  installer.

## New environment variables

| Variable | Set by | Effect |
| --- | --- | --- |
| `WG_RUNTIME` | the sidecar launcher | `desktop` switches on local mode: system-browser OAuth, the local settings store, the loopback origin. Absent everywhere else. |
| `WG_SELF_ORIGIN` | the sidecar launcher | The loopback origin the server was actually bound to, for OAuth redirects. |
| `WG_PUBLIC_URL` | the operator (optional) | Canonical origin for a hosted deployment, used for redirects and canonical URLs. |
| `WG_PYTHON` | the sidecar launcher, or the operator | Python interpreter for the design catalogue. Defaults to `python3`. |
| `WG_VERSION` | the build | Reported by `/api/health`; shown in support output. |
| `WG_PYTHON_DIR` | the Windows build (optional) | An embeddable Python distribution to bundle. |
| `WG_TARGET_TRIPLE` | the Windows build (optional) | Overrides the Rust host triple when cross-building the sidecar name. |
| `WG_REMOTE_URL` | the Android build (optional) | The `https://` deployment the APK opens. Blank means the app asks once on first run. |

Existing variables (`ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `WG_SECRET`, `WG_DATA_DIR`, `OLLAMA_HOST`, …) keep
their meanings. On the desktop the first, second and last of those can also be
set from the Profile screen instead.

## Limitations

Stated plainly, because a packaging document that hides these is useless:

1. **The `.exe` and `.apk` themselves were not produced here.** Building the
   Windows installer needs the MSVC toolchain (`ring` wants `lib.exe`), and the
   APK needs the Android SDK; this container has neither. That is what the CI
   workflows are for.

   What *was* verified here: the Rust shell compiles (`cargo check` and
   `cargo build`, Tauri 2.11), and the built shell was then run headlessly
   under Xvfb — it opened its window, spawned the Node sidecar, booted the
   bundled server on a loopback port, navigated to it, rendered the sign-in
   screen, and left no orphaned process when it exited. That run is what caught
   the symlink problem described below; a configuration that had only been
   read over would have shipped it.

   The remaining Windows-specific unknowns are the NSIS bundling step and
   WebView2, neither of which has a Linux equivalent to stand in for it.
2. **The Android app needs a server.** It is a client, not a copy. With no
   reachable backend it shows a plain-language offline screen rather than a
   broken page.
3. **iOS is not addressed.** Capacitor would carry the same shell across, but
   nothing here has been built or tested for it, and the requirement asked for
   Android.
4. **The installer is unsigned.** Windows SmartScreen will warn on first run
   until the artifact is signed with a code-signing certificate — a purchase
   and an organisational decision, not a build flag.
5. **Ollama is not bundled.** The local model that improves design queries
   remains a separate, optional install; the app detects it and works without
   it.
6. **Auto-update is not wired up.** Tauri's updater needs a signing key and a
   release endpoint; today a new version means downloading a new installer.
7. **Desktop uploads still go through the server.** They are written to
   `%APPDATA%`, so the app can consume disk there like any desktop application;
   nothing prunes it automatically.
