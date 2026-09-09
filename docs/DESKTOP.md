# The Windows application

The builder is a Windows desktop application: an installer, a Start Menu entry,
its own window, its own process. No browser, no terminal, no localhost, no
Node, no npm, no Python, no Git.

    Download installer → double-click → Install
        → Open from the Start Menu
        → First launch sets the machine up, once
        → Ready

Everything after that first launch is: double-click, the window opens.

## Why Tauri, and what actually runs

The application is a Node server — all 44 routes are server-rendered, it uses
native modules (`better-sqlite3`, `sharp`) and it runs Python for the design
catalogue. Nothing about that fits a static frontend, so the shape is:

```
website-generator.exe        Tauri shell (Rust): window, lifecycle, setup screen
   ├── wg-node bootstrap/    first launch only: inspect, install, verify
   └── wg-node sidecar/      the real application server, on 127.0.0.1:<free port>
           └── the window is navigated to it once it answers
```

Tauri rather than Electron because the shell is genuinely a shell: a window and
two child processes. It uses the WebView2 runtime that ships with Windows
instead of bundling a second copy of Chromium, and the Rust binary is a few
megabytes against Electron's hundred-plus. The application code is untouched by
the choice — it is the same server that runs on a hosted deployment.

The window is a real application window: minimise, maximise, close, resize, its
own taskbar entry and icon, and a single-instance guard so a second double-click
focuses the window that is already open rather than starting a second server
against the same database.

## First launch

The setup screen is native to the application — a window with steps and
progress, never a console.

```
Application launched
        ↓
Is it initialised?  ──yes──▶  start the server, open the app   (~1s)
        │no
        ▼
Check the computer      Windows version, CPU, cores, RAM, GPU, VRAM,
        ↓               CUDA, free disk space
Check components        which runtimes are already present
        ↓
Install UI/UX Pro Max   npm install ui-ux-pro-max-cli → uipro init --ai claude
        ↓
Prepare local AI        install Ollama only if it is missing
        ↓
Recommend a model       shown with the reason; nothing downloads until you agree
        ↓
Download                real byte counts, resumable
        ↓
Verify                  the model must answer, not just exist
        ↓
Mark initialised        %APPDATA%\app.websitegenerator.desktop\setup-state.json
        ↓
Open the application
```

The bootstrap is a Node process that reports newline-delimited JSON on stdout
and takes answers on stdin; the shell renders that as the setup screen. Keeping
it out of Rust is what makes `npm run test:setup` possible — 40 checks over
first launch, second launch, "only what is missing", an interrupted download,
a failed step, and a damaged state file, none of which need a window.

### What is installed, and what is not

Nothing is installed that is already there. The setup checks first, every time:

| Component | If present | If missing |
| --- | --- | --- |
| Node | always — it ships inside the app | — |
| Python | used for the catalogue search | the catalogue falls back to built-in rules; setup continues |
| UI/UX Pro Max | kept, with its version reported | installed with its own CLI |
| Ollama | used as it is, models included | installed with winget, or the vendor's installer |
| The model | kept and verified | downloaded after you confirm |

### Choosing a model

The local model has one narrow job here: turn business facts into a good query
for the design catalogue, as JSON. That is why the ladder is short and capped —
past a few billion parameters a larger model writes the same four-word query
while costing gigabytes and a slower first generation.

| This computer | Model | Download |
| --- | --- | --- |
| under 8 GB RAM | Qwen 2.5 0.5B | ~0.4 GB |
| 8 GB or more | Qwen 2.5 1.5B | ~1 GB |
| 16 GB or more | Qwen 2.5 3B | ~1.9 GB |

Disk space is a hard constraint, not a preference: with too little free space
the recommendation steps back down the ladder and says so. A model already
configured and suitable is kept rather than replaced. The screen shows what was
picked, why, and the alternatives, and **nothing is downloaded until the user
chooses** — including "skip", which leaves an application that still generates
websites from the catalogue and the creator's own inputs.

### If something fails

Every step reports what went wrong in plain language with a Try again, and the
optional ones (the design system, the local AI) also offer Continue without it.
Setup is marked complete only when each step has verified or been consciously
skipped, so a half-finished install is never mistaken for a finished one.

An interrupted model download is recorded as unfinished. The next launch says
"Finishing your setup" and continues the download — Ollama keeps the blobs it
already has, and nothing here deletes them to "start clean".

## Later launches

```
Double-click → read setup-state.json → start the server → navigate → done
```

Measured in this environment: **1.1 seconds** from launching the executable to
the application answering. No hardware probing, no network calls, no
reinstalling, no browser. The only background process is the application server
itself, which stops when the window closes.

An application update does not redo any of this. The state file carries a
bootstrap revision; setup re-runs only when a release genuinely changes what has
to be installed, and even then it re-runs only the steps that changed. Models
are never deleted by an update.

## The builder is a desktop interface

The workspace is a persistent sidebar plus the full width of the window:
application destinations at the top, the current project's screens beneath.
There is no bottom tab bar. The editor is two panels — sections on the left, the
site itself on the right, large enough to judge a change by, refreshed on every
save. Dialogs are centred over the workspace, and every control answers the
pointer.

Resizing still works: below 1024px the sidebar becomes a drawer and the editor
drops to one column. That is a fallback for a small window, not a phone layout.

**Generated customer websites are unchanged.** They remain mobile-first and
fully responsive — 44px touch targets, no horizontal overflow at any width, one
fluid column on a phone. The QA suite holds the two products to their two
different standards on purpose: 24px pointer targets for the builder, 44px touch
targets for what it generates.

## Development is unaffected

```bash
npm run dev            # the web app, as before
npm run build && npm start
npm run desktop:dev    # the desktop server exactly as the shell runs it
```

The packaged application sets `WG_RUNTIME=desktop`; a development server does
not, and behaves exactly as it always has. Setup only ever runs from the shell.

## Building the installer

```bash
npm ci
npm run build:windows
#   → desktop/tauri/src-tauri/target/release/bundle/nsis/*.exe
```

Requires Windows with Rust and the Tauri prerequisites. The build stages the
standalone server, the Node runtime, npm (so first-launch setup can install the
design system), the bootstrap, and optionally an embeddable Python
(`WG_PYTHON_DIR`). See [PACKAGING.md](PACKAGING.md) for the full build
reference, the Google Cloud configuration and the environment variables.

## Limitations, stated plainly

1. **The `.exe` was not built here.** This container has no MSVC toolchain, so
   NSIS bundling and WebView2 remain untested. Everything else was tested by
   compiling the shell and running it: `.github/workflows/desktop-release.yml`
   builds the installer on `windows-latest`.
2. **Ollama's Windows installation could not be exercised here.** winget is the
   primary path and is silent; without it the vendor's own installer is
   downloaded and run visibly, because inventing silent flags for a third-party
   installer is exactly the kind of guess that breaks on a user's machine. Both
   paths report failure clearly and can be retried, and the application works
   without local AI either way.
3. **Windows shortcuts are the installer's.** The NSIS installer creates the
   Start Menu entry and offers a desktop shortcut on its finish page; this is
   Tauri's own bundling, not something this project reimplements.
4. **The installer is unsigned.** SmartScreen will warn until the artifact is
   signed with a code-signing certificate.
5. **Auto-update is not wired up.** A new version means a new installer. The
   state file's revision field is what will make an update skip work that is
   already done.
