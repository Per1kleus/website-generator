# The Windows application

The builder is a Windows desktop application: an installer, a Start Menu entry,
its own window, its own process. No browser, no terminal, no localhost, no
Node, no npm, no Python, no Git.

    Download installer → double-click → Install
        → Open from the Start Menu
        → First launch sets the machine up, once
        → Ready

Everything after that first launch is: double-click, the window opens.

Using the application rather than building it?
[GETTING-STARTED.md](GETTING-STARTED.md) covers the same ground without the
engineering.

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
Prepare the application its own folders, from the manifest
        ↓
Check the computer      Windows version, CPU, cores, RAM, GPU, VRAM,
        ↓               CUDA, free disk space
Check components        which runtimes are already present
        ↓
Install design skills   every required file, then the catalogue is run
        ↓
Check free space        the WHOLE job, before anything large is fetched
        ↓
Prepare local AI        install Ollama only if it is missing, verifying the
        ↓               installer before it is run; poll until it answers

Recommend a model       shown with the reason; nothing downloads until you agree
        ↓
Download                real byte counts, resumable
        ↓
Verify                  the model must answer, not just exist
        ↓
Mark initialised        only if every component is accounted for
                        %LOCALAPPDATA%\app.websitegenerator.desktop\setup-state.json
        ↓
Open the application
```

The bootstrap is a Node process that reports newline-delimited JSON on stdout
and takes answers on stdin; the shell renders that as the setup screen. Keeping
it out of Rust is what makes `npm run test:setup` possible — 128 checks over
first launch, second launch, "only what is missing", an interrupted download, a
failed download, a model that will not load, a deleted model, a damaged
catalogue, a full disk, a record from an older version, a damaged record, and the
readiness and repair paths inside the running application. None of them need a
window.

### One manifest

`desktop/bootstrap/manifest.json` is what a complete installation consists of,
and it is the only place that says so. The bootstrap reads it; so does the
running server, through `src/server/setup-manifest.ts`.

| Section | What it decides |
| --- | --- |
| `runtime` | Node minimum, and that Python is optional |
| `skills` | every required skill, the files that prove it, and the call that verifies it |
| `ai.requiredModel` | **the** model identifier — `WG_OLLAMA_MODEL` overrides it, nothing else may name a default |
| `ai.models` | the hardware ladder |
| `ai.readiness` | start, install, poll and verify timeouts |
| `ai.installer` | the download URL and the integrity rules applied before it is run |
| `application` | required directories, and the state file's name |
| `completion` | which components are mandatory, and which may be declined |
| `disk` | the space budget for the whole first launch |

`revision` is bumped only when a release genuinely needs an installed component
to change.

### What is installed, and what is not

Nothing is installed that is already there. The setup checks first, every time:

| Component | If present | If missing |
| --- | --- | --- |
| Node | always — it ships inside the app | — |
| Python | used for the catalogue search | the catalogue falls back to built-in rules; setup continues |
| UI/UX Pro Max | kept, with its version reported — checked file by file, not by the directory existing | installed with its own CLI; a copy that has lost files is repaired |
| Ollama | used as it is, models included | installed with winget, or the vendor's installer after the download is verified |
| The model | kept, and still asked to answer | downloaded after you confirm |

Neither Ollama nor the model is inside the installer. Roughly: the catalogue is
~12 MB from npm, Ollama is a ~700 MB download that installs ~4.5 GB, and the
model is ~400 MB. Budget about **9 GB free** with no Ollama, or **3.5 GB** with
it — the check runs before any download and refuses with both figures rather than
starting something that cannot finish.

**The installer is verified before it is executed.** The bytes received must
match the declared length, the size must be plausible, and the file must carry a
real Windows executable signature; `WG_OLLAMA_SETUP_SHA256` pins an exact digest
when an operator has one. Ollama publishes no stable per-release digest at a
floating URL, so a pin cannot ship in the manifest honestly — every check that
does not need one does.

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

An interrupted model download is recorded as unfinished — marked pending *before*
the download starts, so a machine switched off mid-download is a known state. The
next launch says "Finishing your setup" and continues the download; Ollama keeps
the blobs it already has, and nothing here deletes them to "start clean".

**Completion is a rule, not a screen.** `application`, `runtime` and `skills`
must have verified. `ollama` and `model` must have verified *or* have been
declined by the user after they saw the failure — recorded as `skipped`, with the
installation marked `degraded`. Anything else and `completedAt` stays null, the
status is `failed`, and the next launch carries on from where it stopped.

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
are never deleted by an update. A record written by an earlier release is read
for what it proves and carried forward rather than discarded, so an existing
installation is not made to reinstall everything.

### "Complete" is a claim about the computer

The launch check is cheap — a handful of `stat` calls and, when a model is
recorded as installed, one request to a daemon on the same machine — but it is a
check, not a reading of the record:

| Situation | Reported as | What is done |
| --- | --- | --- |
| A download was cut off | `resume-download` | continue the pull |
| A required catalogue file is gone from the installed copy | `skills-missing` | reinstall that skill only |
| The model was deleted from Ollama | `model-missing` | download that model only |
| The revision changed | `update` | only the steps that changed |
| Repair was asked for in the application | `repair` | only what is missing |

A daemon that cannot be reached is "unknown", never "the model is gone": Ollama
may simply not have started, and reopening setup for that would be wrong.

### Repair Installation

**Profile → Installation**, in the application itself.

- **Check installation** reports every component against this machine and loads
  the model to confirm it answers.
- **Repair installation** provisions only what is missing. A missing model is
  downloaded there and then; anything needing the launcher becomes a repair
  request the next launch honours. Nothing working is removed and nothing present
  is downloaded again.

Neither shows a filesystem path or a stack trace.

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
#   → desktop/tauri/src-tauri/target/release/bundle/nsis/WebsiteGenerator-Setup.exe
```

Requires Windows with Rust and the Tauri prerequisites. The build stages the
standalone server, the Node runtime, npm (so first-launch setup can install the
design system), the bootstrap, and optionally an embeddable Python
(`WG_PYTHON_DIR`). See [PACKAGING.md](PACKAGING.md) for the full build
reference, the Google Cloud configuration and the environment variables.

The installer is always written as `WebsiteGenerator-Setup.exe`. Tauri names it
after the product and version; the build renames the file it produced, because
the filename is what a person is told to download and what they look for in
their downloads folder a week later.

### From a machine that is not Windows

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
apt-get install nsis            # or your system's equivalent
npm run build:windows:cross
```

This is Tauri's documented cross-compilation path. Two things differ from a
build on Windows, and both are handled by `scripts/build-desktop.mjs`: the Node
runtime that ships in the installer is downloaded from nodejs.org for the
target platform — at the same version this repository is tested with, and
checked against the release's own `SHASUMS256.txt` — rather than copied from
the building machine, where it would be the wrong architecture entirely; and
`cargo-xwin` fetches the MSVC C runtime and the Windows SDK from Microsoft the
first time it runs, so the build needs to reach `aka.ms` and
`download.visualstudio.microsoft.com`.

A cross-built installer is still a real installer, but it has not been run on
Windows by the machine that made it. `.github/workflows/desktop-release.yml`
builds on `windows-latest`, and that is the artefact to ship.

## Limitations, stated plainly

1. **An installer was built here; it has not been run on Windows.** The
   development container this was written in has no Windows machine to install
   on, so what can be stated is exactly what was observed:

   - `WebsiteGenerator-Setup.exe` was produced, 48.3 MB, and is a real NSIS
     self-extracting installer (`PE32 executable (GUI) … Nullsoft Installer`).
   - It carries 4,146 files, 187.7 MB uncompressed: the shell
     (`PE32+ executable (GUI) x86-64, for MS Windows`), `WebView2Loader.dll`,
     the Node runtime as `wg-node.exe`, the standalone server, the sidecar
     launcher, the bootstrap, npm, and `uninstall.exe`. No `data/` directory
     and no `.env` file are in it.
   - The generated `installer.nsi` was read rather than assumed:
     `RequestExecutionLevel user`, install into `$LOCALAPPDATA\Website Generator`,
     a Start Menu shortcut, a desktop shortcut offered on the finish page, a
     "run now" finish option, `WriteUninstaller`, and the application data
     directory removed only when the person ticks the box for it.
   - It was **cross-compiled from Linux against the `windows-gnu` target**,
     because this container cannot reach Microsoft's hosts for the MSVC C
     runtime that `cargo-xwin` needs. Tauri supports MSVC on Windows; the GNU
     ABI is not its supported configuration, and nothing here has launched the
     result, clicked through the installer, or seen WebView2 render a page.

   So: a genuine artefact, and not a substitute for the supported one.
   `.github/workflows/desktop-release.yml` builds on `windows-latest` with
   MSVC, and that is the installer to ship.
2. **Ollama's Windows installation could not be exercised here.** winget is the
   primary path and is silent; without it the vendor's own installer is
   downloaded and run visibly, because inventing silent flags for a third-party
   installer is exactly the kind of guess that breaks on a user's machine. Both
   paths report failure clearly and can be retried, and the application works
   without local AI either way.

   What *was* exercised, against a stub: the readiness polling (a daemon not
   answering yet, and one that never answers), the model pull with real byte
   counts, an interrupted pull and its resumption, a pull that fails, a model
   that is listed but will not load, a deleted model, and every rejection path of
   the installer verification — a truncated download, an implausible size, a page
   served instead of an executable, and a checksum that does not match. What was
   not exercised is the real `OllamaSetup.exe` and the real winget.
3. **Windows shortcuts are the installer's.** The NSIS installer creates the
   Start Menu entry and offers a desktop shortcut on its finish page; this is
   Tauri's own bundling, not something this project reimplements.
4. **The installer is unsigned.** SmartScreen will warn until the artifact is
   signed with a code-signing certificate.
5. **Auto-update is not wired up.** A new version means a new installer. The
   state file's revision field is what will make an update skip work that is
   already done.
6. **A real Windows first launch has not been performed.** Everything in "First
   launch" above is implemented and tested headlessly through the same bootstrap
   the shell spawns, including the failure and recovery paths. Installing the
   `.exe` on Windows, watching the setup screen, letting Ollama's own installer
   run, downloading a real model and confirming the second launch is immediate
   remains one real run — and this document does not claim it has happened.
