# Website Generator — Developer and Client Guide

A working manual for two different people:

- **Part A** is for the developer or technical administrator who installs,
  configures, runs and delivers the system.
- **Part B** is for the business owner whose website is being built. It
  assumes no technical knowledge and explains every term it uses.

Everything in this document describes the application **as it is currently
implemented**. Where a capability does not exist, this guide says so rather
than describing it aspirationally.

> **Never paste a real API key, token, password or client secret into this
> document, into a ticket, or into a chat message.** Every example below uses
> obvious placeholders.

---

## Table of contents

**Part A — Developer**

1. [Initial installation](#a1-initial-installation)
2. [Configuration](#a2-configuration)
3. [AI: Gemini and Ollama](#a3-ai-gemini-and-ollama)
4. [Google integrations](#a4-google-integrations)
5. [GitHub and GitHub Pages](#a5-github-and-github-pages)
6. [Custom domains](#a6-custom-domains)
7. [Website creation workflow](#a7-website-creation-workflow)
8. [Digital menu workflow](#a8-digital-menu-workflow)
9. [Backup and recovery](#a9-backup-and-recovery)
10. [Testing and final verification](#a10-testing-and-final-verification)

**Part B — Business owner**

1. [What to give your developer](#b1-what-to-give-your-developer)
2. [Reviewing your website](#b2-reviewing-your-website)
3. [Asking for changes](#b3-asking-for-changes)
4. [Approving the website](#b4-approving-the-website)
5. [Your domain name](#b5-your-domain-name)
6. [After it goes live](#b6-after-it-goes-live)
7. [Analytics and Google](#b7-analytics-and-google)
8. [If something does not work](#b8-if-something-does-not-work)

**Closing**

- [Final developer checklist](#final-developer-checklist)
- [Final client checklist](#final-client-checklist)
- [Documentation audit](#documentation-audit)

---
---

# PART A — DEVELOPER

---

## A1. Initial installation

### A1.1 What you need before starting

| Requirement | Why | Required? |
| --- | --- | --- |
| **Node.js 22** | The application, the build and every test suite run on it. CI pins 22. | Required |
| **npm** | Dependency install. | Required |
| **Python 3** | Runs the vendored `ui-ux-pro-max` design catalogue (`vendor/ui-ux-pro-max/scripts/search.py`). Without it, designs fall back to built-in presets. | Strongly recommended |
| **Chromium** | Only for the browser test suites (mobile, preview, studio). Not needed to run the app. | Optional |
| **Ollama** | A small local model that writes better design-catalogue queries. Without it a built-in rule set writes them. | Optional |
| **Rust + Tauri toolchain** | Only if you build the Windows desktop installer. | Optional |

The application is a **Node server**. Every route is server-rendered and it
uses native modules (`better-sqlite3`, `sharp`). There is no static build you
can drop on a CDN.

### A1.2 Installing

```bash
git clone <your repository url>
cd website-generator
npm install          # runs scripts/setup.mjs afterwards, via postinstall
npm run build
npm start            # or: npm run dev
```

### A1.3 What the installer actually does

`npm install` triggers `postinstall` → `node scripts/setup.mjs`. Read the
script if in doubt; it is short. It:

1. Checks that `vendor/ui-ux-pro-max/scripts/search.py` exists and that
   `python3` runs. If either is missing it prints a note and continues.
2. Probes Ollama at `OLLAMA_HOST` (default `http://127.0.0.1:11434`) with a
   2-second timeout.
3. If Ollama is running and the model (`WG_OLLAMA_MODEL`, default
   `qwen2.5:0.5b`) is absent, it downloads it and prints progress.

> **`setup.mjs` never fails the install.** It is wrapped in `|| true`. Every
> step it performs is optional — the application generates websites without
> any of it. Do not read a clean `npm install` as proof that Ollama or Python
> are present; read the script's own output.

### A1.4 What happens on first launch

- The SQLite database is created and migrated on the **first query**, not at
  import time (`src/server/db.ts` opens lazily behind a Proxy).
- `data/`, `data/uploads/` and `data/exports/` are created.
- The server performs the same Ollama probe as the setup script, once per
  process, in the background. A first generation is never held up by a model
  download.
- There are **no users**. You create the first account through the sign-up
  screen; there is no seeded administrator and no default password.

### A1.5 What requires your explicit confirmation

Nothing installs a credential for you, and nothing connects an external
account on your behalf. You must deliberately:

- create the first account,
- supply `GEMINI_API_KEY` if you want AI research and generation,
- create the Google OAuth client and connect a Google account,
- create the GitHub OAuth app (or set `WG_GITHUB_TOKEN`) and connect GitHub,
- set `WG_SECRET` on any multi-user deployment.

### A1.6 Where data is stored

Everything lives under `WG_DATA_DIR` (default `./data`):

| Path | Contents |
| --- | --- |
| `data/app.db` | SQLite: users, sessions, projects, versions, assets metadata, deployments, client previews, menu sources, Google properties, encrypted Google/GitHub tokens |
| `data/uploads/<assetId>.webp` | Every uploaded or Drive-fetched image, one file per asset id |
| `data/published/<slug>/` | Built-in hosting: the served static site |
| `data/exports/` | Generated ZIP exports |
| `data/backups/` | Automatic pre-delete project backups |
| `data/settings.enc` | Desktop only: encrypted local settings (see A2.3) |

> **Backing up `data/` by copying the folder is not enough while the server is
> running.** SQLite is in WAL mode. Use the project backup feature (A9), or
> stop the server first.

### A1.7 Verifying the installation

```bash
curl -s http://localhost:3000/api/health
```

Expected shape (values vary):

```json
{"ok":true,"mode":"server","version":"0.0.0",
 "googleConfigured":false,"aiConfigured":false,"oauthFlow":"web-redirect"}
```

This endpoint is deliberately unauthenticated and returns **only** the public
allowlist in `src/server/runtime.ts`. It never exposes a credential — only
whether one is configured.

Then:

```bash
npm run typecheck     # must be clean
npm run test:site     # no server or network needed
```

**Expected result:** health returns `ok: true`, typecheck prints nothing, and
the site suite reports `282/282 checks passed`.

> `npm run lint` is currently broken — Next 16 removed `next lint` and reads
> `lint` as a directory name. Use `npm run typecheck`. CI does not run lint.

---

## A2. Configuration

### A2.1 The full variable list

Every variable the application reads. **Secret** means it must never appear in
a repository, a log, a screenshot or a generated website.

#### Core

| Variable | What it does | Required | Secret | Where | If missing |
| --- | --- | --- | --- | --- | --- |
| `WG_DATA_DIR` | Where the database, uploads, published sites and backups live. | Optional (default `./data`) | No | Server env | Data lands in `./data` next to the code — easy to lose on redeploy |
| `WG_SECRET` | Encrypts stored Google and GitHub tokens at rest (AES-256-GCM). | **Required on any multi-user deployment** | **Yes** | Server env | A key is derived from the data directory path. Fine for a single-user local install; **anyone who can read the disk can derive it**. Rotating it invalidates stored tokens — creators reconnect |
| `WG_PUBLIC_URL` / `WG_SELF_ORIGIN` | The origin the server is really reachable at. Used for OAuth redirects and canonical URLs. | Optional | No | Server env | Falls back to the request origin. Set it behind a proxy |
| `WG_VERSION` | Version string reported by `/api/health`. | Optional | No | Server env | Reports `0.0.0` |
| `WG_RUNTIME` | Set to `desktop` by the desktop launcher. | Do not set by hand | No | Set by launcher | — |

#### AI

| Variable | What it does | Required | Secret | Where | If missing |
| --- | --- | --- | --- | --- | --- |
| `GEMINI_API_KEY` | Business research, visual identity analysis, content generation, translation, free-form AI editing. | Optional | **Yes** | Server env, or desktop settings screen | The app still works end to end using a template generator and a rule-based editor. Research is skipped; content comes from what the creator typed |
| `WG_GEMINI_MODEL` | Which Gemini model those features use. | Optional (default `gemini-2.5-pro`) | No | Server env | Uses the default |
| `GEMINI_BASE_URL` | Override the API host. Used by the test stub. | Optional | No | Server env | Uses Google's |
| `OLLAMA_HOST` | Where the local model daemon is. | Optional (default `http://127.0.0.1:11434`) | No | Server env, or desktop settings | The built-in rule set writes design-catalogue queries instead |
| `WG_OLLAMA_MODEL` | Which local model. | Optional (default `qwen2.5:0.5b`) | No | Server env | Uses the default |
| `WG_OLLAMA_AUTOPULL` | `0` disables automatic model download. | Optional | No | Server env | Downloads on first launch if absent |
| `WG_PYTHON` | Python executable for the design catalogue. | Optional | No | Server env | Uses `python3` from PATH |
| `WG_UIUX_SKILL_DIR` | Where the vendored catalogue lives. | Optional | No | Server env | Uses `vendor/ui-ux-pro-max` |

#### Google

| Variable | What it does | Required | Secret | Where | If missing |
| --- | --- | --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth client id. | Required for any Google feature | No (public by design) | Server env, or desktop settings | Menus, Analytics and Search Console are unavailable; the connect screen says the server is not configured |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (web clients). | Required for web deployments | **Yes** | Server env, or desktop settings | Same as above. A desktop build uses PKCE and does not require one |
| `GOOGLE_REDIRECT_URI` | Override the callback URL. | Optional | No | Server env | Derived as `<origin>/api/google/callback` |
| `GOOGLE_OAUTH_BASE`, `GOOGLE_TOKEN_URL`, `GOOGLE_USERINFO_URL`, `GOOGLE_SHEETS_BASE`, `GOOGLE_DRIVE_BASE`, `GOOGLE_ANALYTICS_ADMIN_BASE`, `GOOGLE_ANALYTICS_DATA_BASE`, `GOOGLE_SEARCH_CONSOLE_BASE` | Host overrides so the flow can be tested against a stub. | Optional | No | Server env / tests | Uses Google's real hosts |

#### GitHub

| Variable | What it does | Required | Secret | Where | If missing |
| --- | --- | --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | OAuth app client id. | Required to let creators connect their own GitHub | No | Server env | The publish screen says GitHub is not set up on this server |
| `GITHUB_CLIENT_SECRET` | OAuth app client secret. | Required with the above | **Yes** | Server env | Same |
| `WG_GITHUB_TOKEN` | **Single-operator alternative**: one GitHub account for everybody on this install. Needs the `repo` scope. | Optional | **Yes** | Server env | No operator-wide account; each creator connects their own |
| `WG_GITHUB_LOGIN` | Display name for the operator account. | Optional | No | Server env | The UI shows no login name |
| `GITHUB_REDIRECT_URI` | Override the callback URL. | Optional | No | Server env | Derived as `<origin>/api/github/callback` |
| `GITHUB_API_BASE`, `GITHUB_WEB_BASE` | Host overrides for testing. | Optional | No | Server env / tests | Uses GitHub's |

> **A bare `GITHUB_TOKEN` is deliberately ignored.** GitHub Actions exports it
> on every run and the `gh` CLI sets it too. Treating it as permission to
> publish client websites into somebody's account would be a serious surprise,
> so the application reads only `WG_GITHUB_TOKEN`. Do **not** "fix" this by
> renaming the variable.
>
> Do **not** set `WG_GITHUB_TOKEN` on a shared deployment. Every creator on
> that install would publish into that one account.

#### Other deploy targets and DNS

| Variable | What it does | Required | Secret | Where | If missing |
| --- | --- | --- | --- | --- | --- |
| `VERCEL_TOKEN` | Enables the Vercel target. | Optional | **Yes** | Server env | Vercel shown as "not connected" |
| `NETLIFY_AUTH_TOKEN` | Enables the Netlify target. | Optional | **Yes** | Server env | Netlify shown as "not connected" |
| `WG_DNS_SERVERS` | Comma-separated resolvers for custom-domain checks. | Optional | No | Server env | Uses the system resolvers |

> Vercel and Netlify upload **only the default-language document** — they are
> not full multi-page deployments. For client work use GitHub Pages or
> built-in hosting.

### A2.2 Where to put them

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored — keep it
that way. In production, set them through your process manager or container
environment rather than a file on disk.

### A2.3 Desktop: the in-app settings screen

The desktop build has no terminal, so four values can be set from inside the
application (**Account → Settings**), stored encrypted in
`data/settings.enc` with the same AES-256-GCM helper as the OAuth tokens:

```
GEMINI_API_KEY   GOOGLE_CLIENT_ID   GOOGLE_CLIENT_SECRET   OLLAMA_HOST
```

That list (`EDITABLE_SETTINGS` in `src/server/settings.ts`) is an allowlist —
a variable not named there cannot be written by any request. Secret values are
read back only as a "configured" flag plus a last-four hint; the API that
wrote a key cannot be used to recover it.

**GitHub credentials are not in that list.** On desktop, GitHub is connected
through OAuth in the system browser, or by the operator setting
`WG_GITHUB_TOKEN` in the environment.

---

## A3. AI: Gemini and Ollama

### A3.1 Two different models, two different jobs

| | Gemini (hosted) | Ollama (local) |
| --- | --- | --- |
| Configured by | `GEMINI_API_KEY` | `OLLAMA_HOST` |
| Used for | Research, visual identity, content, SEO metadata, translation, AI editing | Writing one good query to the design catalogue |
| Without it | Template generator + rule-based editor; no research | A built-in rule set writes the query |
| Required? | No | No |

### A3.2 Connecting Gemini

1. Create an API key in Google AI Studio.
2. Set `GEMINI_API_KEY` in the server environment (or the desktop settings
   screen).
3. Restart the server.

### A3.3 What Gemini does in research

`researchBusiness()` uses grounded generation (Google Search plus, when the
creator supplied one, URL context for the business's existing website) to
produce a **BusinessProfile** with a `verifiedFields` list. The distinction
matters: the SEO engine only writes claims from verified fields.

An existing website is treated as **untrusted external content**: it is one
research source among several, read and summarised. It cannot reach the
Gemini key, Ollama, the database, authentication, internal APIs, user files,
Google credentials or application settings, and no code from it is executed.
An unreachable website is reported and the run continues.

### A3.4 What Gemini does in generation and editing

- **Content** — headlines, body copy, button labels, per section.
- **Translation** — the flat i18n string catalog only. It physically cannot
  touch structure, layout, prices, links or phone numbers, because those are
  not in the catalog. That is what makes "changing language never changes the
  design" true rather than promised.
- **SEO metadata** — title, description, OG fields, keywords, per language.
- **AI editing** (`/api/projects/[id]/ai`) — a free-form instruction, scoped
  to a section and a locale, validated through `validateSiteDoc` so a
  malformed response falls back to the stored document.

Without a key, all of these have deterministic fallbacks and the application
remains fully usable.

### A3.5 What must never reach a generated website

Nothing in this list is ever written into a published site, and the test
suites assert it against the produced bytes:

- `GEMINI_API_KEY`, `WG_SECRET`
- Google OAuth access/refresh tokens
- GitHub tokens, `GITHUB_CLIENT_SECRET`, `WG_GITHUB_TOKEN`
- Session cookies, password hashes
- Database contents, internal API paths, project ids

The **only** Google value that legitimately reaches a generated website is the
public GA4 measurement id (`G-XXXXXXXXXX`), and only when Analytics is
configured for that project.

### A3.6 Verifying the AI setup

```bash
curl -s http://localhost:3000/api/health     # aiConfigured: true
npm run test:gemini                          # 75/75 — drives a stub, no key needed
```

Then generate a project and watch the progress screen. With a key you will see
research stages naming the business; without one the first stage reads
"Reading your details".

> **Do not put a Gemini key in the browser, in a client-side file, or in a
> repository.** It is read only inside server modules.

---

## A4. Google integrations

One OAuth connection serves three features. There is no second Google login.

### A4.1 Scopes

| Scope | Feature | When requested |
| --- | --- | --- |
| `spreadsheets.readonly` | Read menu rows | Base — always |
| `drive.readonly` | List spreadsheets, fetch `imageurl` Drive images | Base — always |
| `analytics.readonly` | Google Analytics reports | Only when Analytics is switched on |
| `webmasters.readonly` | Search Console reports | Only when Search Console is switched on |

Optional scopes use **incremental consent** (`include_granted_scopes=true`):
granting Analytics keeps the Sheets and Drive access already granted.

Everything is read-only. The application never writes to anyone's Drive,
Sheets, Analytics or Search Console.

### A4.2 What the developer does

1. In Google Cloud Console, create an OAuth client:
   - **Web application** for a hosted deployment,
   - **Desktop app** for the packaged desktop build (PKCE, no secret shipped).
2. Add the redirect URI: `https://<your-origin>/api/google/callback`
3. Enable the APIs you intend to use: Sheets, Drive, Google Analytics Data,
   Google Analytics Admin, Search Console.
4. Add the four scopes above to the consent screen.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
6. Restart, and confirm `/api/health` reports `googleConfigured: true`.

### A4.3 What the client does

The **client** does almost nothing here. Google is connected by whoever
operates the application, using an account that has access to the client's
spreadsheet / Analytics property / Search Console property. If the client owns
those, they must share them with that account, or connect their own.

For Search Console specifically, **domain ownership verification happens in
Search Console**, by whoever controls the domain. This application reads the
verification state; it cannot grant it.

### A4.4 Connecting, reconnecting, disconnecting

- **Connect**: Account → Google → Connect. On desktop this opens the system
  browser (Google refuses OAuth inside an embedded webview).
- **Status** (`/api/google/status`) returns booleans only: connected, email,
  and per-capability `sheets` / `drive` / `analytics` / `searchConsole`.
  Capabilities are read from the scopes Google **actually granted**, not from
  what was requested.
- **Reconnect**: run Connect again. Tokens are replaced; a missing refresh
  token is kept from the previous grant.
- **Disconnect** (`/api/google/disconnect`) deletes the stored tokens. Nothing
  published is affected. Menu configuration and Analytics property selections
  survive; they simply cannot be used until Google is reconnected.

### A4.5 When a permission is missing

| Symptom | Cause | Fix |
| --- | --- | --- |
| Connected, but "not every permission was approved" | A scope was declined on the consent screen | Reconnect and leave both base permissions ticked |
| Analytics screen says access has not been granted | The optional scope was never requested | Use the Analytics connect button, which asks for it |
| "Your Google connection has expired" | 401 from Google; grant revoked or token unusable | Reconnect |
| "Google denied access to that file" | The connected account cannot read that spreadsheet | Share the sheet with the connected account |

### A4.6 Analytics and Search Console

- **Analytics**: pick a GA4 property; the application reads the **measurement
  id from the property's web data stream** rather than asking anyone to type
  one. Reports: visitors, sessions, page views, top pages, devices.
- **Search Console**: pick a site; `permissionLevel` of `siteUnverifiedUser`
  is reported as **not verified**. Reports: clicks, impressions, CTR,
  position, top queries, top pages.
- Date ranges: **7 days, 28 days, 3 months, 6 months**. Search Console queries
  are shifted back two days because its most recent days are incomplete.
- There is no cached "last known good" figure. A failing API produces a
  message, never a number.

> **Consent is not compliance.** The application records that you have said
> you handled visitor consent. It does not obtain consent, and it makes no
> claim that your use of Analytics is lawful. That is for you and your client's
> legal adviser.

---

## A5. GitHub and GitHub Pages

The production publishing path:

```
Generated website → private GitHub repository → GitHub Pages → public website
                                                      → optional client domain
```

The repository stays **private** (the client's photographs, prices and draft
copy). GitHub Pages serves the built files publicly without making the
repository readable.

### A5.1 Creating the OAuth app

1. <https://github.com/settings/developers> → New OAuth App.
2. Authorization callback URL: `https://<your-origin>/api/github/callback`
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`; restart.

**Scope requested: `repo` — and only that.** It is the narrowest classic scope
that covers creating a private repository, pushing to it and changing its
Pages settings. `public_repo` would make every client website public, which is
the one thing this feature must not do.

### A5.2 Required GitHub plan

GitHub Pages **from a private repository requires GitHub Pro or an
organisation plan**. On a free personal account, enabling Pages on a private
repo fails — the application reports this in plain words rather than showing a
403.

### A5.3 Connecting

Project → Publish → choose **GitHub Pages** → **Connect GitHub**. A state
value in an httpOnly cookie protects the callback; a forged callback is
rejected. The token is stored encrypted and is never returned by any route,
rendered into any page, written into any website, or logged.

The publish screen shows which account it publishes as, and whether the
connection is a personal OAuth one or an operator-wide token.

### A5.4 First publication

1. Project → Publish.
2. The **publish gate** runs (see A7.5). Fatal problems block; warnings do not.
3. The bundler builds the static site for the GitHub Pages URL.
4. The provider:
   - looks the repository up by name; creates it **private** only if genuinely
     absent,
   - re-asserts `private: true` on **every** publish,
   - uploads the whole tree as **one commit** (blobs → tree → commit → move
     ref), so a visitor never sees a page from one version and an image from
     another,
   - enables Pages on the default branch root (`build_type: legacy` — no
     Jekyll, no build step),
   - records repository, commit, Pages status and URL.

**Repository name** is derived deterministically from the project slug
(`repoNameFor`), re-slugified so it can only ever contain `a–z`, `0–9` and
hyphens.

**Expected result:** status `live`, URL
`https://<login>.github.io/<repo>/`, repository shown as `private/<repo>`.

> A brand-new Pages site takes a minute or two to build. The deployment is
> genuinely complete; the screen separately shows GitHub's own build status.

### A5.5 Republishing

- The deployment **row is reused** for the same project and slug, so the same
  repository is updated — no second repository, no second address.
- The tree is replaced wholesale, so a photograph removed in the app actually
  leaves the repository.
- **The link you already gave the client never moves.**

### A5.6 When there are no changes

"Changes since publication" compares a **SHA-256 fingerprint of the site
document** against the one that went live — not timestamps, which move when a
project is merely opened. With no changes, the Publish-changes button is
disabled and the screen says the live website already matches the project.

### A5.7 Unpublishing

Pages is switched **off**. The repository, its history and every file in it
stay exactly where they are. The slug stays reserved, so publishing again puts
the site back at the same address.

> **Never delete a client's repository to "unpublish".** Nothing in the
> application does this, and doing it by hand destroys the recovery path
> described in A9.

### A5.8 Rollback

Rollback is the existing version system: Project → Versions → restore. The
restored document is saved as a **new version at the front of history**
(nothing is deleted, so the rollback is itself reversible), and then you
publish normally. The deployment records which version is live.

### A5.9 What to verify after every publication

1. Deployment status is `live`, `error` is empty.
2. Repository is `private`.
3. Only **one** repository exists for that project.
4. Open the public URL and confirm the page renders.
5. Confirm the change you just made is visible.
6. If a custom domain is connected: the `CNAME` file is still in the
   repository and GitHub still has the domain configured.

---

## A6. Custom domains

```
client buys a domain → DNS records → detection → GitHub Pages configuration
                                                       → HTTPS → Active
```

> **The application cannot change anybody's DNS.** It has no DNS provider
> connected. It validates the name, records it, tells GitHub about it, shows
> the exact records to create, and then **observes**. No button anywhere
> pretends otherwise.

Custom domains are available for **GitHub Pages deployments only**. Built-in
hosting shows an explanation instead: point the domain at the server you are
running and terminate HTTPS there.

### A6.1 Domain validation

Accepted: a bare hostname, a pasted `https://…` URL, a trailing slash,
capitals.

Refused, with a specific reason:

| Input | Why |
| --- | --- |
| `example.gr/shop` | A path. Not silently trimmed — trimming would connect a *different* domain than typed |
| `user@example.gr`, `example.gr:8080` | User-info, port, query or fragment |
| `localhost`, `shop.internal`, `intranet.local`, `staging.test`, `demo.example` | Reserved/internal names. No certificate authority will ever issue for them |
| `192.168.1.10`, `10.0.0.1`, `127.0.0.1` | Private or loopback addresses |
| `printer.home.arpa` | Internal network name |
| `185.199.108.153` | An IP address is not a domain |
| `something.github.io` | A GitHub address, not a domain you can connect |
| A single label, a 300-character name, characters outside `a–z 0–9 -` | Not a valid hostname |

### A6.2 Apex vs subdomain

| | Apex / root | Subdomain |
| --- | --- | --- |
| Example | `clientbusiness.gr` | `www.clientbusiness.gr` |
| Records | **Four A records** | **One CNAME** |
| Why | DNS forbids a CNAME at the apex — this is a DNS rule, not a GitHub one | A CNAME is the correct record for a subdomain |

The application detects which it is and shows only the records that shape of
domain can actually use.

### A6.3 Exactly what the client enters at their registrar

**Apex domain — `clientbusiness.gr`:**

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | 3600 |
| A | `@` | `185.199.109.153` | 3600 |
| A | `@` | `185.199.110.153` | 3600 |
| A | `@` | `185.199.111.153` | 3600 |

**Subdomain — `www.clientbusiness.gr`:**

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `www` | `<login>.github.io` | 3600 |

The screen shows each field with its own **Copy** button, because a registrar
form has three boxes filled one at a time. The `Name` column shows what the
registrar asks for (`@`, `www`, or `shop.eu` for `shop.eu.example.gr`) — not
the whole hostname.

### A6.4 How records are checked

`inspectDns` resolves the name with a resolver that ignores the process cache
(a cached negative answer from ninety seconds ago is exactly the answer that
must not be reused), then `compareDns` marks each required record found or
missing and lists conflicts.

### A6.5 What each state means

| State | Meaning | What to do |
| --- | --- | --- |
| **DNS configuration required** | The name does not resolve at all | Create the records shown |
| **Waiting for DNS** | It resolves, but not to GitHub Pages — the message names what it points at instead | Fix the records; wait for propagation |
| **DNS detected** | It reaches GitHub Pages. If some records are missing, the message says "2 of 4 records are in place" | Add the rest; publish to finish configuration |
| **Configuring GitHub Pages** | The domain has just been set on GitHub | Wait, then check again |
| **HTTPS pending** | DNS is right and GitHub knows the domain; the certificate is not issued yet | Wait — usually minutes, up to an hour |
| **Active** | An actual HTTPS request to the domain succeeded | Nothing. It is live |
| **Needs attention** | The stored name is not usable | Re-enter the domain |

**A conflict** is a record that exists and should not — an A record pointing
somewhere else (a quarter of visitors would go there), or a CNAME on an apex
domain. The message names the value found and says to remove or change it. It
never says "DNS failed".

> **"Active" requires a real HTTPS request to succeed.** Correct DNS alone is
> never enough to mark a domain active.

### A6.6 Changing a domain

The old name is **cleared from GitHub first**, then the new one is recorded.
If clearing fails the change is refused and the old domain keeps working —
a failure halfway leaves one working domain, never none. This also prevents a
stale claim blocking whoever legitimately wants that name next.

### A6.7 Removing a domain

Disconnect clears it from GitHub Pages and puts the website back on its GitHub
Pages address, which never stopped working. **Nothing else is touched**: not
the project, not its versions, not the repository, not the client previews,
not the content. The project remains publishable.

### A6.8 If the process fails halfway

| Failure point | State afterwards | Recovery |
| --- | --- | --- |
| GitHub refuses the domain on connect | Domain recorded, error shown, state `dns-required` | The next publish sets it |
| DNS never propagates | Stays `waiting-dns` / `dns-required` | Records are still shown; check again later |
| Certificate never issues | Stays `https-pending` | The Pages URL still works; wait or re-check the records |
| Old domain cannot be cleared on change | Change refused, **old domain still live** | Retry in a moment |

### A6.9 Check throttling

- An **automatic** re-check waits 60 seconds.
- A person pressing **Check again** really looks; only a double-click within 3
  seconds is absorbed (the response says `throttled: true`).
- Telling GitHub about a domain clears the last observation, so the next check
  cannot repeat a conclusion drawn before the configuration changed.

---

## A7. Website creation workflow

```
Research → Generation → Preview → Editing → QA → Publish → Domain → Handoff
```

### A7.1 Research and creation (one screen)

Project → New. Fields: business name (required), business type, Google Maps
link, existing website URL, location, phone, email, description, site kind,
style preset, languages.

**A Maps link OR a written description OR a location is enough** — the form
refuses only when all three are absent.

Site kinds: full business website, digital menu, portfolio, landing page,
bookings. 16 languages are supported.

**Check:** the business name is spelled exactly as the client writes it — it
becomes the repository name, the slug and the SEO title.

### A7.2 Generation

Press Generate. Stages, in order: research → design catalogue → visual
identity → architecture → content → layout → design review → translation →
SEO → visual QA at four viewports → build.

Progress is polled from `/api/projects/[id]/status`, so locking the screen
mid-run does not restart anything.

**Expected result:** status `ready`, the preview appears automatically.

### A7.3 Preview

Project → Preview renders the real document at **Desktop 1440 / Tablet 834 /
Mobile 390 / Narrow 320**. It is the same renderer that publishes, so what you
see is what ships.

### A7.4 Editing

| Screen | Use |
| --- | --- |
| **Edit sections** | Reorder, hide, add, remove, edit text per section, per language |
| **Design** | Palette, architecture, tokens |
| **Images** | Upload, replace, set the logo, alt text |
| **Languages** | Add, remove, set default, re-translate |
| **AI editing** | Free-form instruction, scoped to a section and language |
| **Versions** | Numbered history; restore any version |

A run of manual edits within two minutes folds into one version, **except**
when a client preview points at that version — a shared version is frozen and
the next edit starts a fresh one.

### A7.5 QA and the publish gate

Readiness (`lib/checklist.ts`) scores out of 100:

| Category | Points |
| --- | ---: |
| Rendering & functionality | 25 |
| Mobile & responsive | 20 |
| SEO | 15 |
| Content | 15 |
| Images | 10 |
| Accessibility | 10 |
| Performance | 5 |

A critical finding overrides the score's status. **One-click safe fixes**
(`/api/projects/[id]/fix`) apply only corrections to decisions the application
made — heading scale, line length, rhythm, which photo leads, an empty
section. **It never rewrites the business's own words.**

The **publish gate** blocks on critical findings, showing the issue and its
correction. Warnings are listed but never block. Missing translations are the
one deliberate exception: critical on the checklist (they cost score), but not
a blocker — the page renders and text falls back.

> **Neither score is a Lighthouse result** and every screen that shows them
> says so.

### A7.6 Publish, domain, handoff

Publish (A5) → connect the domain if there is one (A6) → create a **client
preview link** and send it for approval.

A client preview is pinned to one saved version. The token is 43 characters of
crypto-strong randomness, unrelated to the project id. The client sees the
website and nothing else — no Gemini, no Ollama, no credentials, no design
tools, no project database, no generation controls. They can approve or
request changes; they cannot modify the document. An approval stays attached
to the version it was given for, so **an old approval is never treated as
approval of a changed website**.

---

## A8. Digital menu workflow

### A8.1 The spreadsheet

Exactly these six column headers, spelled exactly like this (lowercase, and
`chefs choice` with a space and no apostrophe):

```
name | price | description | chefs choice | category | imageurl
```

| Column | Rules |
| --- | --- |
| `name` | Required. An empty name means the row is skipped, reported as an error |
| `price` | Empty = priced on request. A bare number is rendered to 2 decimals. Anything containing a digit is accepted as written (`8,50`, `€8.50`, `12.00 / 18.00`, `from 9`). Anything else is an error and the item is not displayed |
| `description` | Optional |
| `chefs choice` | Empty = no. True: `true`, `yes`, `y`, `1`, `✓`, `✔`, `☑`, `x`. False: `false`, `no`, `n`, `0`, `☐`, `-`. Anything else is a warning |
| `category` | Required. Empty = the item is not displayed. Suggested values are offered in the UI (Starters, Main Courses, Salads, Pasta, Pizza, Seafood, Meat, Sides, Desserts, Wines, Beers, Cocktails, Soft Drinks, Coffee, Other) |
| `imageurl` | Optional. A Google Drive link, or a plain `https://` image address. Anything else is reported |

Items are keyed by `category|name`, so re-syncing an unchanged item keeps its
identity and its translations survive.

### A8.2 Images

- A **Drive link** is downloaded once and cached as a project asset; a
  re-sync reuses the cache unless Sync Now forces a re-download.
- A **plain https URL** is passed through as-is.
- Non-image Drive files, and files over 20 MB, are rejected with a reason.

### A8.3 Synchronising

Project → Menu data → pick spreadsheet → pick tab → validate columns → Sync.

Validation reports **per row**: which row, which column, what is wrong. Errors
mean the item is not displayed; warnings mean it is displayed with a
fallback.

**A version is saved before every sync** ("Before menu sync"), so a bad
spreadsheet edit is always undoable.

### A8.4 When the sheet changes

Nothing happens automatically. Press **Sync**. If the website is already live:

- **Built-in hosting**: the published files are rewritten in place.
- **GitHub Pages**: a normal republish runs in the background (the only way to
  change a commit is to push another one).

### A8.5 A safe menu update

1. Edit the spreadsheet.
2. Sync; read the validation findings.
3. Preview the menu.
4. Publish (or confirm the automatic republish reached `live`).
5. Open the public URL and check the changed item.

> **Do not rename the six column headers.** They are the contract with every
> spreadsheet already in use.

---

## A9. Backup and recovery

### A9.1 When to create one

- Before delivering a website to a client.
- Before a risky edit or a bulk change.
- Before upgrading or migrating the application.
- Before deleting anything.
- On a schedule you decide — there is no scheduler in the application.

### A9.2 What a backup contains

Project metadata and settings · the website document (design tokens, content,
translations and SEO all live inside it) · **every version** with its own
document · client previews with their approvals and the version each was
pinned to · deployment metadata (platform, slug, URL, repository owner and
name, Pages URL, custom domain, published version) · menu source configuration
· Analytics and Search Console property ids · business profile, design system,
design answers · logo reference · **all uploaded images**.

### A9.3 What it does NOT contain

GitHub tokens · Google access/refresh tokens · Gemini API keys · `WG_SECRET`
or any encryption key · password hashes · session cookies · any encrypted
credential blob.

The writer **refuses to produce** a backup whose manifest contains a forbidden
key or a token-shaped value, and the test suite greps the produced bytes.

### A9.4 Exporting

Project → **Backup**.

- **"What is in it?"** describes the backup without downloading: format
  version, size, counts, the repository recorded, integrity status.
- **"Export backup"** downloads `<business>-<YYYY-MM-DD>.wgbackup.zip`. The
  response carries `X-Backup-Version` and `X-Backup-Checksum` headers.

Inside: `backup.json` plus `assets/<id>.webp`.

### A9.5 Inspecting

Project → Backup → **Choose a backup file**. This reads and verifies without
writing anything, and shows every check by name:

```
✓ Archive             21 files
✓ Backup structure    format 1 of 1
✓ Integrity           checksum matches
✓ Completeness        21 files as recorded
✓ Website document    5 sections, 2 languages
✓ Assets              18 verified
✓ Version history     7 found
✓ Client previews     1 link, pinned to its version

⚠ Reconnection required
  GitHub — will reuse the existing repository <owner>/<repo>
  Google — reconnect to sync the menu spreadsheet again
```

A damaged backup fails the matching check by name — a truncated archive fails
**Completeness**, an edited manifest fails **Integrity**, a corrupted image
fails **Assets** — and nothing is written.

### A9.6 Restoring

Press **Restore as a new project**.

**Why a new project:** the person restoring is recovering from a loss, and the
one outcome worse than a failed restore is a successful one that lands on top
of work they still had. There is no "restore over" path — the restore route
does not even take a project id.

| What | What happens |
| --- | --- |
| **Versions** | All restored, in order, with their labels and numbering. Ids are remapped per restore, so restoring twice gives two independent projects |
| **Assets** | Bytes written, rows recreated, ids remapped — and the website document rewritten to point at the new ids |
| **Client previews** | The record, the approvals and the pinned version are restored. The **link is not**: the token is the capability, so a new one must be sent. Restored links start withdrawn |
| **Deployment** | Repository, URL, custom domain and published version restored. If the recorded repository name is free here, the restored project **reuses it** — publishing updates the live site rather than creating a second one. If it is taken, a new one is used and the restore says so |
| **Custom domain** | Restored but marked unverified — nothing has been checked since the backup |
| **GitHub / Google credentials** | **Not restored.** Reconnect them |

### A9.7 Automatic backups

One is taken automatically into `data/backups/` immediately before a project
is deleted. The last 10 are kept. A backup that cannot be written never blocks
the deletion; it is logged.

> ### ⚠ Automatic local backups are not disaster recovery.
>
> They live on the same disk as the database they protect. A failed disk, a
> lost laptop, a wiped container or a deleted volume takes them too.
>
> **Export a backup and keep it somewhere else** — another machine, external
> storage, or your own backed-up cloud folder. That is the copy that survives
> losing the computer. Treat the automatic copies as an undo button for
> "I deleted the wrong project", and nothing more.

---

## A10. Testing and final verification

### A10.1 Automated suites

```bash
npm run typecheck && npm run build

# No server needed
npm run test:site           # 282
npm run test:design-systems # 59

# Start their own server/stubs
npm run test:design         # 21
npm run test:menu           # 93
npm run test:gemini         # 75
npm run test:setup          # 40
npm run test:desktop        # 55
npm run test:github         # 175
npm run test:backup         # 95

# Need the app running on port 3100
npm run test:preview        # 60
npm run test:studio         # 230
npm run test:mobile         # 223
```

CI runs all of them on every push.

### A10.2 Pre-delivery checklist

Complete **every** line before handing a website to a client.

**Rendering and layout**

- [ ] Desktop (1440) — no horizontal scroll, nothing overlapping
- [ ] Tablet (834) — sections stack sensibly
- [ ] Mobile (390) — readable without zooming
- [ ] Narrow mobile (320) — still not broken
- [ ] Navigation opens and closes on a phone
- [ ] Every button goes somewhere; no button with no destination
- [ ] Every internal anchor lands on a section that exists

**Content**

- [ ] Business name spelled exactly as the client writes it
- [ ] Phone number correct — **dial it**
- [ ] Email correct — **send a test message**
- [ ] Address and map point at the right place
- [ ] Opening hours correct
- [ ] Prices correct
- [ ] No placeholder text ("Welcome to our website", lorem ipsum)
- [ ] Every enabled language actually translated
- [ ] Language switcher works and does not change the design

**Images**

- [ ] Every image loads
- [ ] No image stretched or badly cropped
- [ ] The logo is the client's real logo
- [ ] Alt text on meaningful images

**SEO and accessibility**

- [ ] Title and meta description present and specific per language
- [ ] `sitemap.xml` and `robots.txt` present in the published output
- [ ] Canonical and hreflang links correct
- [ ] Readiness score reviewed; **zero critical findings**
- [ ] Accessibility findings reviewed
- [ ] Body text contrast passes

**Performance**

- [ ] Performance score reviewed
- [ ] Mobile payload reviewed
- [ ] Web font has a real local fallback stack

**Forms and interaction** *(where applicable)*

- [ ] Call, email and map links open the right application on a phone
- [ ] Booking link goes to the right place
- [ ] Sticky call-to-action does not cover content

**Digital menu** *(where applicable)*

- [ ] Every category appears
- [ ] Prices match the spreadsheet
- [ ] Chef's choice items are marked
- [ ] Menu images load
- [ ] Validation findings reviewed
- [ ] Sync → publish → the change is live

**Publishing**

- [ ] Live preview matches the published site
- [ ] Published URL opens
- [ ] HTTPS works with no browser warning
- [ ] Repository is **private**
- [ ] Only one repository for the project
- [ ] Published site works with the generator **closed**

**Custom domain** *(where applicable)*

- [ ] Correct records for apex vs subdomain
- [ ] All records detected
- [ ] No conflicting records
- [ ] GitHub Pages shows the domain
- [ ] `CNAME` file present after the most recent publish
- [ ] Status is **Active**, not merely "DNS detected"
- [ ] `https://the-domain/` opens with a valid certificate

**Google** *(where applicable)*

- [ ] Analytics connected to the **client's** property
- [ ] The measurement id in the page is the client's
- [ ] No Analytics code if Analytics is not configured
- [ ] Search Console property verified **by Google**
- [ ] Consent responsibility discussed and recorded

**Handoff**

- [ ] Backup exported and stored **off this machine**
- [ ] Client preview link sent
- [ ] Client approval received against the current version
- [ ] Client told the final URL and what to do about changes

---
---

# PART B — BUSINESS OWNER

This part is for you, the business owner. No technical knowledge is assumed.
Anything technical is explained in plain words the first time it appears.

---

## B1. What to give your developer

The more of this you provide, the better your website will be — and the fewer
rounds of corrections you will need.

**About the business**

- [ ] **Business name**, spelled exactly as you want it to appear
- [ ] **What the business does**, in a few sentences
- [ ] **Google Maps link** — open Google Maps, find your business, press
      Share, and copy the link
- [ ] **Existing website address**, if you have one (even an old one)

**How customers reach you**

- [ ] **Phone number**, exactly as it should be dialled
- [ ] **Email address**
- [ ] **Full street address**
- [ ] **Opening hours** for each day
- [ ] **Social media links** (Facebook, Instagram, and so on)

**Pictures**

- [ ] **Logo** — the best quality file you have
- [ ] **Photographs** — the real business, not stock photos where you can
      avoid it. Well-lit, not blurry, the right way up
- [ ] For each photo, a note on what it shows

**What you sell**

- [ ] **Services or products**, with a short description of each
- [ ] **Prices**, if you want them shown
- [ ] For a **restaurant, café or bar**: your full menu — dish name, price,
      description, category (Starters, Main Courses, and so on), and which
      dishes are your recommendations

**Languages**

- [ ] Which languages your website should be in

> **Do not send passwords by email or chat.** Your developer does not need
> your Google password, your bank details, or your social media passwords. If
> they need access to something, they will ask you to share it properly from
> inside that service.

---

## B2. Reviewing your website

Your developer will send you a link. Open it on a computer **and** on your
phone. Go through this slowly — you know your business better than anyone.

**The basics**

- [ ] Is the **business name** spelled correctly? Check accents and capitals
- [ ] Is the **description** accurate? Does it sound like you?
- [ ] Are the **services or products** right? Anything missing? Anything there
      that you no longer offer?

**Contact details — test them, do not just read them**

- [ ] **Tap the phone number on your phone.** Does it dial the right number?
- [ ] **Send a test email** to the address shown. Does it arrive?
- [ ] **Tap the address or map.** Does it show your actual location?
- [ ] Are the **opening hours** right, including holidays and closing days?

**Prices**

- [ ] Is every price correct and current?
- [ ] Is the currency right?
- [ ] For a menu: is every dish there, in the right category?

**Pictures**

- [ ] Is every photograph really of your business?
- [ ] Is anything cut off badly, or upside down?
- [ ] Is the logo the right one, and the current one?

**On different screens**

- [ ] On your **phone**: can you read everything without zooming? Do you have
      to scroll sideways? (You should not.)
- [ ] On a **tablet**, if you have one
- [ ] On a **computer**

**Everything else**

- [ ] Do all the **buttons** work? Tap every one
- [ ] Any **spelling mistakes**? Read every sentence
- [ ] If you have more than one language: switch between them. Is every
      language translated, or is some text still in the other language?

---

## B3. Asking for changes

Your developer cannot see what you see. The more precisely you describe a
change, the faster and more accurately it is made.

**A good request names four things:**

1. **Where** — which page and which section
2. **What** — the exact text or image you mean
3. **What is wrong**
4. **What it should be instead**

**Good:**

> In the "Our Services" section, the second item says "Plumbing repares".
> It should be "Plumbing repairs".

> The photo at the top of the page is the old shop. Please use the attached
> photo of the new one.

> In Contact, the phone number is 210 000 0000. The correct number is
> 210 111 1111.

**Not useful:**

> I don't like it.

> Something's wrong with the pictures.

> Can you make it nicer?

If you genuinely dislike the look, say **what** feels wrong — "it feels too
dark", "the writing is too small to read", "it feels cold, we're a family
bakery". That your developer can act on.

**Send all your changes together** in one message where you can. A list of
twelve changes in one go is one round of work; twelve separate messages over
three days is twelve.

---

## B4. Approving the website

### When is it ready?

When you have gone through the review list in B2 and everything is correct.

### How approval works

Your developer sends you a link. On that page you can:

- **Approve** — you are happy with it as it is, or
- **Request changes** — with a written note about what you want different

You do not need an account, a password or a login. The link is private and
unguessable; treat it like a key and only share it with people who should see
the website.

### What approval means

Approval is attached to **the exact version you looked at**. It is your
confirmation that this version is correct and can be published.

### What if you want changes after approving?

That is completely normal, and nothing breaks. Your developer makes the
changes and sends you a **new link**, because your earlier approval belongs to
the earlier version. The system will never treat an old approval as approval
of a changed website — which protects you as much as your developer.

---

## B5. Your domain name

### What is a domain?

A domain is your website's address — the thing people type, like
`clientbusiness.gr`. You rent it, usually a year at a time, from a company
called a **registrar**.

### Who buys it?

**You do**, in your own name, with your own account and your own card.

> **Keep the domain in your own name.** It is one of the few things about your
> website you should never hand over. If your developer buys it for you, ask
> them to transfer it into your account, and keep the login details yourself.

### Do you need one?

No. Your website works from the moment it is published, at an address your
developer gives you. A domain simply makes it *your* address, which looks more
professional and is easier to remember.

### What is DNS?

DNS is the internet's address book. It turns `clientbusiness.gr` into the
place where your website actually lives. Buying a domain gets you the name;
DNS is the step that points the name at your website.

### What you have to do

1. Buy the domain, or find the login for the one you already own.
2. Tell your developer the exact domain name.
3. Your developer sends you a short list of **DNS records** — a few lines of
   settings.
4. Log in to your registrar, find the DNS settings, and add exactly those
   records. Your registrar's help pages will call it "DNS", "Name servers" or
   "Advanced DNS".
5. Tell your developer you have done it.

**A simple example.** You own `clientbusiness.gr`. Your developer sends you:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | @ | 185.199.108.153 | 3600 |
| A | @ | 185.199.109.153 | 3600 |
| A | @ | 185.199.110.153 | 3600 |
| A | @ | 185.199.111.153 | 3600 |

You add those four lines at your registrar and save. Each column goes in the
matching box on their form. `@` means "the domain itself".

If you find this intimidating, you have two good options: ask your developer
to do it with you on a screen-share, or give them temporary access to the
registrar account and change the password afterwards.

### What your developer does

Everything else: connecting the domain to the website, checking that your
records are correct, and confirming the secure connection works.

### How long does it take?

Usually minutes. Sometimes up to 24 hours. The secure padlock can take up to
another hour after that. **This waiting is normal** and is not a sign that
anything is wrong.

### How you know it is working

Type `https://clientbusiness.gr` into a browser. Your website opens, and there
is a **padlock** next to the address. That is it.

Until both are true, your developer's screen will say which step is still in
progress.

---

## B6. After it goes live

### Your website address

Your developer will give you the final address. It is either:

- your own domain — `https://clientbusiness.gr` — if you connected one, or
- an address ending in `.github.io` if you did not.

Both are real, public websites. The second one works perfectly well; it just
is not your own name.

### Checking it

Open it on your phone and on a computer. Send it to a friend and ask them to
open it. Search for your business name in Google after a few days — new
websites take a little while to appear.

### If you want changes

Contact your developer. **You do not edit the website yourself** — changes are
made in the application your developer uses, and then published. This is on
purpose: it is what keeps the design consistent and stops the website breaking.

Agree in advance with your developer how changes work: how to request them,
how quickly they happen, and what is included.

### When your menu changes

If you have a digital menu, your prices and dishes come from a **spreadsheet**.
Depending on what you agreed:

- **You edit the spreadsheet** and tell your developer to sync it, or
- **Your developer edits it** for you.

Either way, the change appears on the website only after a sync and a publish.
It is not instant. Allow for that before printing a QR code.

### When your business information changes

New phone number, new hours, moved premises, new services — tell your
developer. These live in the website itself, not the spreadsheet, so they are
changed and republished in the application.

---

## B7. Analytics and Google

Both of these are optional. Your website works without them.

### Google Analytics

Counts visitors to your website. It can tell you roughly:

- how many people visited,
- how many visits there were,
- which pages they looked at,
- whether they used a phone or a computer.

Useful for questions like "did the leaflet work?" or "do people look at the
menu on their phone?" It is **not** a list of who visited — you do not see
names, and you cannot contact anyone through it.

### Google Search Console

Shows how your website appears in Google search results:

- what people searched before they saw you,
- how often you appeared,
- how often they clicked,
- roughly where you appear in the results.

Useful for "are people finding me when they search for my kind of business?"

### Setting them up

Your developer connects these. You may need to give them access to your Google
account for these services, or create the accounts with them.

### ⚠ About consent and the law

Analytics collects information about visitors. In many countries, including
across the EU, that has legal requirements attached — a cookie or consent
notice, a privacy policy, and possibly more.

**This application does not do any of that for you, and connecting Analytics
is not a statement that your website complies with anything.** The application
only records that someone has said they are handling it.

Deciding what your business must do, and doing it, is the responsibility of
you and a qualified adviser — a lawyer or a data-protection professional.
Neither your developer nor this software can take that responsibility on, and
neither should claim to.

---

## B8. If something does not work

Work down the "What I check" column first. Most problems are on that list.

| Problem | What I check | What I do | When I contact the developer |
| --- | --- | --- | --- |
| **The website does not open at all** | Is my internet working? Do other sites open? Did I type the address exactly right? Have I tried another browser or my phone? | Try again in 10 minutes | If other websites work and mine still does not |
| **My domain does not work, but the other address does** | Did I add the DNS records exactly as sent? Did I save them? How long ago? | Wait up to 24 hours | After 24 hours, or if you are unsure the records saved. Send a screenshot of your DNS settings |
| **"Not secure" / no padlock** | Is the domain new or recently connected? | Wait up to an hour after the domain starts working | If the warning is still there the next day |
| **A change I asked for does not appear** | Did the developer confirm it was published? Am I looking at the right address? Have I refreshed the page — hold Shift and click reload? Does it appear on my phone? | Hard refresh, then check on another device | If it is missing on every device after a refresh |
| **Wrong picture** | Which page and section? Do I have the correct picture file? | Send the page, the section, and the correct picture | Straight away, with the replacement attached |
| **Wrong information** (phone, hours, price) | What exactly is shown, and what should it say? | Write both down | Straight away — wrong contact details cost you business |
| **The menu did not update** | Did I save the spreadsheet? Is the dish in the right category with a valid price? Has a sync been done since I edited it? | Save the spreadsheet, then ask for a sync | If the sync was done and it is still wrong — say which dish and which row |
| **A problem with the Google connection** | Nothing you can check yourself | Nothing | Straight away. Do not send your Google password — they do not need it |

**When you contact your developer, include:**

- what you were doing,
- what you expected,
- what happened instead,
- the address you were looking at,
- the device (iPhone, Android, laptop) and browser,
- a screenshot if you can.

---
---

# Final developer checklist

Use this as a sign-off sheet, once per delivered website.

**Environment**

- [ ] `npm run typecheck` clean, `npm run build` clean
- [ ] `/api/health` reachable and reporting the expected configuration
- [ ] `WG_SECRET` set (any multi-user deployment)
- [ ] `WG_DATA_DIR` on persistent storage
- [ ] No secret committed, logged, or in a screenshot
- [ ] `WG_GITHUB_TOKEN` **not** set on a shared deployment

**Project**

- [ ] Business name, contact details, hours and prices confirmed with the client
- [ ] All client photographs uploaded, logo set
- [ ] Every enabled language actually translated
- [ ] Readiness reviewed — **zero critical findings**
- [ ] Preview checked at 1440 / 834 / 390 / 320

**Publishing**

- [ ] Published to GitHub Pages
- [ ] Repository is **private**
- [ ] Exactly one repository for this project
- [ ] Public URL opens and renders
- [ ] Site works with the generator closed
- [ ] `hasChanges` is false after the final publish

**Domain** *(if applicable)*

- [ ] Correct record type for apex vs subdomain
- [ ] All required records detected, no conflicts
- [ ] `CNAME` file present after the last publish
- [ ] Status **Active** — a real HTTPS request succeeded
- [ ] Old domain cleared, if the domain was changed

**Google** *(if applicable)*

- [ ] Analytics uses the client's own property and measurement id
- [ ] No tracking code when Analytics is not configured
- [ ] Search Console verified by Google, not assumed
- [ ] Consent responsibility explicitly discussed and recorded in writing

**Handoff**

- [ ] Backup exported and stored **off this machine**
- [ ] Backup inspected and every check passed
- [ ] Client preview link sent
- [ ] Approval received against the **current** version
- [ ] Client told: final URL, how to request changes, how menu updates work
- [ ] Domain remains in the **client's** name and account

---

# Final client checklist

**Before your website is built**

- [ ] I gave my developer everything in [B1](#b1-what-to-give-your-developer)
- [ ] My business name is spelled exactly as I want it
- [ ] My photographs are the ones I actually want used

**When I am asked to review it**

- [ ] I opened it on my phone and on a computer
- [ ] I dialled the phone number on the website
- [ ] I sent a test email to the address on the website
- [ ] I tapped the map and it showed my real location
- [ ] I checked every price
- [ ] I checked the opening hours
- [ ] I read every sentence for spelling mistakes
- [ ] I tapped every button
- [ ] I checked every language, if I have more than one
- [ ] I sent all my changes in one clear list

**Before I approve**

- [ ] Everything on the list above is correct
- [ ] I understand my approval applies to the version I am looking at

**My domain** *(if I have one)*

- [ ] The domain is in **my** name, in **my** account
- [ ] I have the registrar login, and I keep it
- [ ] I added the DNS records exactly as sent
- [ ] `https://mydomain` opens my website with a padlock

**After it is live**

- [ ] I know my final website address
- [ ] I opened it and checked it myself
- [ ] I know how to ask for changes, and how long they take
- [ ] I know how menu changes work, if I have a menu
- [ ] I have spoken to a qualified adviser about consent and privacy, if
      Analytics is switched on

---

# Documentation audit

Every claim in this document was checked against the code before it was
written. What follows is what that audit found, including the gaps.

**Verified against the implementation**

| Section | Verified against |
| --- | --- |
| Installation, `setup.mjs` behaviour | `scripts/setup.mjs`, `package.json` |
| Data locations | `src/server/db.ts`, `deploy-model.ts`, `backup.ts`, `settings.ts` |
| Health endpoint and its allowlist | `src/app/api/health/route.ts`, `src/server/runtime.ts` |
| Every variable in A2 | grep of `process.env.*` across `src/` |
| Desktop-editable settings | `EDITABLE_SETTINGS` in `src/server/settings.ts` |
| Generation stages | the `report(...)` calls in `src/server/generator.ts` |
| Creation form rules | `src/app/api/projects/route.ts` |
| Site kinds, languages, styles | `src/lib/site.ts`, `locales.ts`, `styles.ts` |
| Preview viewports | `src/lib/viewports.ts` |
| Readiness categories and weights | `CATEGORY_WEIGHT` in `src/lib/checklist.ts` |
| Publish gate behaviour | `src/server/publish-gate.ts` |
| GitHub scope, repo creation, Pages, unpublish | `src/server/github/*`, `src/server/providers/github.ts` |
| Domain rules, records, TTL, states, conflicts | `src/lib/domain.ts`, `src/server/github/domain.ts`, `src/server/deploy-view.ts` |
| Menu columns, price and chef's-choice parsing, image rules | `src/server/menu/processor.ts`, `drive-images.ts` |
| Backup contents, exclusions, restore semantics | `src/lib/backup-format.ts`, `src/server/backup.ts`, `backup-restore.ts` |
| Client preview semantics | `src/server/client-preview.ts`, `src/server/projects.ts` |
| Analytics and Search Console behaviour | `src/server/google/insights.ts` |
| Suite names and counts | `package.json` and the last full run |

**Deliberately not claimed, because it is not implemented**

- No scheduled or automatic backups on a timer. The only automatic backup is
  the one taken before a project is deleted.
- No automatic DNS configuration. No DNS provider is connected and none can be.
- No domain registration or purchase.
- No certificate issuance — GitHub Pages does that.
- No client-side editing. Clients approve or request changes; they cannot
  modify the document.
- No automatic menu sync. Syncing is always an explicit action.
- No legal-compliance feature. The application records an acknowledgement and
  nothing more.
- No `GET /api/projects` listing endpoint (projects are listed by the page).
- `npm run lint` does not work under Next 16; this is stated rather than
  papered over.

**Known limitations recorded in this guide**

- GitHub Pages from a private repository requires a paid GitHub plan.
- Vercel and Netlify upload only the default-language document.
- Copying `data/` while the server runs is unreliable (SQLite WAL).
- Automatic local backups share a disk with the data they protect.

No application functionality was changed to produce this document.
