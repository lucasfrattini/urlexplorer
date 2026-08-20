<div align="center">

<img src="public/img/logo.png" alt="" width="96" height="96" />

# URL Explorer

**Point it at a paginated website. Walk away with a clean, deduplicated list of
everything that matched.**

Stop clicking "next page" by hand and stop opening forty tabs to check which
files are actually there. Tell URL Explorer where to start, how the site
paginates and what you are looking for, and it does the clicking for you —
live progress, real cancellation, nothing lost, running on your own server.

![Node](https://img.shields.io/badge/node-%E2%89%A520-informational)
![Docker](https://img.shields.io/badge/docker-compose-informational)
![License](https://img.shields.io/badge/license-AGPL--3.0-informational)
![Tests](https://img.shields.io/badge/tests-500-success)

</div>

> ⚠️ **Before you use this:** URL Explorer is a generic pagination crawler — it
> doesn't know or care what site you point it at, and it doesn't bypass
> logins, paywalls, CAPTCHAs or DRM. It only reads what a site already serves
> to a normal visitor. Whether it's legal to access, save or redistribute what
> you find is a question about the site and your jurisdiction, not about this
> software — that responsibility is entirely yours. Details in
> [Responsible use](#responsible-use).

---

## Contents

- [What it is](#what-it-is) · [Features](#features)
- **Getting it running** — [Requirements](#requirements) ·
  [Installation](#installation) · [Updating](#updating) ·
  [Behind a reverse proxy](#behind-a-reverse-proxy)
- **Running it** — [Configuration](#configuration) · [Usage](#usage) ·
  [Data and backups](#data-and-backups) · [Troubleshooting](#troubleshooting)
- **Working on it** — [Architecture](#architecture) · [API](#api) ·
  [Project layout](#project-layout)
- [Responsible use](#responsible-use) · [License](#license)

---

## What it is

URL Explorer is a **self-hosted** tool for exploring paginated websites
systematically. You tell it where to start, how the site paginates and what you
are looking for; it walks, filters and hands you back a clean list.

It works in two phases:

1. **Crawl** — follows the pagination and collects the links matching your
   pattern.
2. **Inspect** — opens each link and locates files with the extensions you
   asked for.

The second phase is optional: if you only want the list of links, it is
skipped.

It also includes a **single-page analyzer** that examines one URL in depth
through four routes: rendered DOM, network requests, embedded players and URLs
found inside scripts. It runs at feature parity with the crawler — live progress
over SSE, cancellation from the progress panel, sortable columns, range filters
and the same export formats — so the two views behave the same way rather than
being one polished tool and one afterthought.

---

## Features

**Crawling engine**

- Three pagination modes: by **query parameter** (`?page=2`), by **template**
  in the URL — which covers path-based pagination (`/page/{page}`), zero-padded
  numbering (`{page:02}`) and less common shapes — and **infinite scroll**, for
  sites that load more results as you scroll instead of having one URL per
  page.
- **Configuration auto-detection**: paste a results URL and the tool proposes a
  link pattern, a pagination mechanism, file extensions and whether a browser is
  needed, explaining the reasoning behind each field. It is an editable
  suggestion, never an imposed configuration.
- **Parameterized search term** with `{q}`: save a site once and only change the
  keyword.
- Link filtering by pattern — plain text or a **regular expression** between
  slashes, `/\/videos\/\d+/`, to tell detail pages apart from section pages —
  and file filtering by the **real extension** of the pathname, not by
  substring matching.
- Optional **browser rendering**, applied to both phases, for sites that build
  their content with JavaScript.

**Results**

- **Live progress** over Server-Sent Events, with phases, a progress bar and
  findings appearing as they are discovered.
- **Real cancellation**: cancelling actually stops the work on the server.
- **Duration and size** for each file, extracted from HTML that was already
  downloaded, with no extra requests. Sizes reported by the server are exact;
  sizes read from the page are marked with `~` so the two are never confused.
- **Range filters** for duration and size, with two handles each. The bounds
  come from the results you actually loaded, and filtering happens in the
  browser — nothing is re-crawled.
- **Duplicate grouping** within a single search: the same content served from
  two places collapses into one row. Nothing is ever discarded, and a toggle
  undoes the grouping.
- **Pause and resume**: stop an exploration in flight and pick it up later
  without repeating the crawl phase or losing what was already found.
- Optional **thumbnails**, proxied and cached by the server — the browser never
  talks to the site being explored, only to your own instance.
- Include and **exclude** text filters, sorting by duration or size, copy and
  export.
- **Keyboard and screen-reader support** throughout: the export menu is fully
  keyboard-navigable, and every confirmation goes through an accessible dialog
  component rather than the browser's native `prompt()` / `confirm()`, which
  cannot be styled, translated or focus-managed.
- **Native autocomplete is disabled on free-text inputs**, so the URLs and terms
  you type are not saved into the browser's form history.

**Extensibility**

- Sites the generic engine cannot handle are solved with **isolated modules**
  under `src/extensions/`, instead of accumulating special cases in the core.
  The loader only reads from that directory, so adding an extension means
  adding reviewed code — never loading it from somewhere else.

**Operations**

- **Docker** with automatic restart and a healthcheck.
- **SSRF** protection, rate limiting, memory and duration caps.
- 500 tests, ESLint and Prettier.

---

## Requirements

- **Docker** and Docker Compose _(recommended)_, **or**
- **Node.js ≥ 20** and npm

Browser mode uses Chromium. The Docker image already includes it; on a local
install Puppeteer provides it.

**Sizing.** Chromium is what makes this heavy, not the crawler itself.

|                     |                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Idle**            | **~45 MB** (measured on a container up for 7 days)                                                                    |
| **HTTP-only crawl** | a few hundred MB, driven by `CRAWL_MAX_FILES` — results are held in memory until the run ends                         |
| **Browser mode**    | budget a few hundred MB _per tab_ in the pool; the default `BROWSER_POOL_SIZE=2` is what the ~1 GB of headroom is for |
| **Disk**            | ~400 MB for the image, Chromium included. State on disk is one small JSON file.                                       |
| **`/dev/shm`**      | **1 GB**, set by `shm_size` in `compose.yaml`                                                                         |

Docker's default `/dev/shm` is 64 MB and Chromium hangs on heavy pages with
that — hence the explicit `shm_size`. Chromium also shuts itself down after
`BROWSER_IDLE_SHUTDOWN_MS` (60 s), so the browser cost is only paid while
actually crawling, which is why idle sits at 45 MB.

On a small VPS: add swap, or set `BROWSER_ENABLED=false` and stay on the
HTTP-only path.

---

## Installation

### With Docker (recommended)

```bash
git clone https://github.com/lucasfrattini/urlexplorer.git
cd urlexplorer

cp .env.example .env      # then edit it
docker compose up -d --build
```

Available at **http://localhost:3001**.

The container restarts on its own if the process dies, and when the machine
boots.

```bash
docker compose logs -f        # follow the log
docker compose restart        # restart
docker compose down           # stop
docker compose up -d --build  # after changing the code
```

> `--build` is not optional: a plain `docker compose up -d` does not rebuild,
> and would leave the image running the previous code.

### Without Docker

```bash
git clone https://github.com/lucasfrattini/urlexplorer.git
cd urlexplorer

npm install
cp .env.example .env
npm start
```

Runs on the port set in `.env` (3000 by default).

```bash
npm run dev     # auto-reload
npm test        # tests
npm run lint    # linter
npm run check   # linter + formatting + tests
```

---

## Updating

```bash
cd urlexplorer
git pull
docker compose up -d --build     # or: npm install && npm start
```

Nothing to migrate: the only state on disk is `data/profiles.json`, and its
format is append-compatible. Your saved configurations survive an update.

What does **not** survive a restart, by design:

- **Paused explorations** (`JOBS_*`) live in memory. A restart discards them.
- **The thumbnail cache** (`THUMBNAILS_CACHE_*`) is in memory too, so it never
  writes result images to disk.

Both are deliberate — results carry the names of the sites you explored, and
keeping them off the disk is the point.

---

## Behind a reverse proxy

If you put nginx, Caddy or Traefik in front (which is how you get HTTPS), there
is **one variable you must set**, and getting it wrong is not cosmetic:

```env
TRUST_PROXY=<the proxy's address>
```

Rate limiting keys off `req.ip`. Express only reads `X-Forwarded-For` when
`TRUST_PROXY` says that source is trusted — so:

- **Left as `false` behind a proxy:** every request looks like it comes from the
  proxy. All your users share one rate-limit bucket and throttle each other.
- **Set to `true`:** Express trusts `X-Forwarded-For` from _anyone_. A client
  that rotates that header **bypasses rate limiting entirely**, including the
  brute-force protection on the admin unlock. Never use `true`.

Set it to the proxy's actual address. Note that `loopback` is not the answer
here if clients also reach the app from localhost.

Minimal nginx example:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;

    # Live progress uses SSE: no buffering, and a long read timeout.
    proxy_buffering    off;
    proxy_read_timeout 3600s;
}
```

`proxy_buffering off` matters: with buffering on, the progress bar stays frozen
until the exploration finishes. `SSE_HEARTBEAT_MS` (15 s by default) exists so
that a proxy does not close a connection that has had nothing to send for a
while.

---

## Configuration

Everything is set through environment variables. `.env.example` documents every
option with its default; only `PORT` is required to boot.

The most relevant ones:

| Variable                           | Default   | Purpose                                                                            |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `PORT`                             | `3000`    | Server port                                                                        |
| `ADMIN_TOKEN`                      | _(empty)_ | Unlocks saved configurations (see below)                                           |
| `CRAWL_MAX_PAGES`                  | `50`      | Maximum pages per exploration                                                      |
| `CRAWL_MAX_FILES`                  | `5000`    | Cap on files held in memory                                                        |
| `CRAWL_MAX_DURATION_MS`            | `600000`  | Maximum duration of one exploration                                                |
| `BROWSER_ENABLED`                  | `true`    | Allow browser mode                                                                 |
| `BROWSER_POOL_SIZE`                | `2`       | Concurrent browser tabs                                                            |
| `THUMBNAILS_ENABLED`               | `true`    | Serve thumbnails through `/api/thumbnail`                                          |
| `SCROLL_MAX_ROUNDS`                | `50`      | Maximum loads in infinite-scroll mode                                              |
| `SCROLL_MAX_DURATION_MS`           | `120000`  | Time cap for the scrolling phase                                                   |
| `SCROLL_MAX_ELEMENTS`              | `3000`    | Accumulated links at which scrolling stops                                         |
| `THROTTLE_MIN_INTERVAL_MS`         | `250`     | Minimum gap between requests to the same host                                      |
| `THROTTLE_MAX_CONCURRENT_PER_HOST` | `4`       | Concurrent requests per host                                                       |
| `SECURITY_BLOCK_PRIVATE_ADDRESSES` | `true`    | SSRF protection                                                                    |
| `SECURITY_ALLOWED_HOSTS`           | _(empty)_ | Optional host allowlist                                                            |
| `RATE_LIMIT_MAX_REQUESTS`          | `30`      | Requests per window                                                                |
| `ADMIN_UNLOCK_MAX_ATTEMPTS`        | `5`       | Unlock attempts per minute                                                         |
| `TRUST_PROXY`                      | `false`   | Who may set `X-Forwarded-For` — see [above](#behind-a-reverse-proxy). Never `true` |

### `ADMIN_TOKEN`

Saved configurations sit behind a manual unlock. It is meant for the case where
**several people share the same computer**: by default the tool shows up empty,
with no visible configurations and no way to save one.

```env
ADMIN_TOKEN=put-your-own-token-here
```

Leave it empty and the mode is disabled entirely: the application works
normally, simply without saved configurations, and the `/api/admin/*` routes
answer `404` — there is no point advertising a door that is not there.

Configurations are stored **on the server**, in `data/profiles.json`, not in the
browser. That directory is listed in `.gitignore`, so the sites you configure
never reach the repository. A fresh install starts with none, which is the
correct behaviour.

To unlock, **click the header logo five times within two seconds** and enter the
token. The same gesture locks it again. The unlock lives in `sessionStorage`:
close the tab and the tool is blank again for whoever sits down next.

This is a gate for everyday use, not a control against a determined attacker:
anyone sharing the machine can watch you type, or read `sessionStorage` while
the session is open. What it does guarantee is that configurations are not part
of the served code, and that saving is validated on the server rather than by
hiding a button.

> Never put a real token in `.env.example` or in any versioned file. `.env` is
> in `.gitignore` for exactly this reason.

### Security

SSRF protection is on by default and stops the application from reaching
loopback, private, link-local or multicast addresses, even when a public domain
resolves to one of them. Only turn it off to test against local fixtures, never
on a reachable deployment.

---

## Usage

### Exploring a site

1. **Start URL** — where the walk begins. It accepts two placeholders:
   - `{q}` — the search term
   - `{page}` — the page number (`{page:02}` if the site uses `01`, `02`, …)
2. **Search term** — inserted wherever `{q}` appears.
3. **Link pattern** — which links you care about. Empty takes them all.
4. **File extensions** — comma-separated. Empty skips the second phase.

If you would rather not work it out by hand, press **Detect configuration**: it
opens the URL and proposes the fields, explaining what each guess is based on.
Review it before launching, because it is a suggestion and it can be wrong.

Working it out manually is straightforward too: go to page 2 on the site and
look at what changes in its URL.

### Link patterns

| Pattern                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| _(empty)_                | Takes every link                                  |
| `/videos/`               | The raw href contains that text                   |
| `https://example.com/v/` | The absolute URL starts with it                   |
| `cats`                   | The absolute URL contains that text               |
| `/\/videos\/\d+/`        | Regular expression: `/videos/` followed by digits |

A pattern is read as a regular expression when it is wrapped in slashes **and
contains at least one metacharacter** (`\`, `^`, `$`, `\d`, `+`, …). A bare
`/videos/` stays literal text, so configurations saved earlier keep their
meaning.

### Sites with infinite scroll

If a site has no pagination controls and loads more content as you scroll, open
**Pagination and advanced options** and pick the _scroll_ mode. Then:

- **Browser rendering** is required: without it there is no scrolling.
- The **To** field means "number of loads", not "number of pages".
- The run stops when no new results appear, or when it hits one of the safety
  caps. If it stops because of a cap the interface says so, because the results
  are incomplete.

### Filtering results

Everything inside the results card acts on what is already loaded and filters in
the browser; nothing there starts a new crawl.

The two range sliders take their bounds from the loaded results. The rule worth
knowing: **a result with no known duration is not removed by the duration
slider**. Filtering by data you do not have can only throw away good results, so
that decision belongs to the "Hide without duration" and "Hide without size"
toggles instead. The counter reads "showing X of Y", so it is always clear how
much is being filtered out.

---

## API

| Method | Route                 | Purpose                                                                |
| ------ | --------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/health`         | Status and active limits                                               |
| POST   | `/api/scrape`         | Full exploration, single response                                      |
| GET    | `/api/scrape/stream`  | The same, with SSE progress (`?resume=<jobId>` continues a paused run) |
| POST   | `/api/scrape/pause`   | Pause a running exploration                                            |
| POST   | `/api/scrape/detect`  | Propose a configuration for a URL                                      |
| POST   | `/api/video/extract`  | Analyze a single URL                                                   |
| GET    | `/api/thumbnail`      | Proxied, cached thumbnail for a result                                 |
| POST   | `/api/admin/unlock`   | Validate the admin token                                               |
| GET    | `/api/admin/profiles` | Saved configurations — token required                                  |
| PUT    | `/api/admin/profiles` | Replace the list — token required                                      |

Any `GET` that does not start with `/api/` serves the frontend shell. Views are
routed by hash: `#/explorer`, `#/video`.

---

## Data and backups

**One file matters, and it is small.**

| What                 | Where                | Backed up?                                |
| -------------------- | -------------------- | ----------------------------------------- |
| Saved configurations | `data/profiles.json` | **Yes — this is the one**                 |
| Your settings        | `.env`               | Yes, keep a copy (it holds `ADMIN_TOKEN`) |
| Paused explorations  | memory               | No, and by design                         |
| Thumbnail cache      | memory               | No, and by design                         |
| Results              | never persisted      | —                                         |

```bash
cp data/profiles.json ~/backups/urlexplorer-$(date +%F).json
```

That is the whole backup. There is no database, and **results are never written
to disk** — an exploration lives in the browser tab that ran it. If you want to
keep results, use the export buttons in the interface.

Restoring is copying the file back and restarting. Keep `.env` somewhere safe
too: it is not in the repo (correctly), so it is the one thing a fresh clone
cannot give you back.

---

## Troubleshooting

**Saving a configuration does nothing, and there is no error.**
The `data/` bind mount is missing. The container runs with `read_only: true`, so
without `- ./data:/app/data` the write fails silently. Check that the line is in
your `compose.yaml` and that `data/` exists on the host.

**The admin unlock does not appear / `/api/admin/*` returns 404.**
That is the documented behaviour when `ADMIN_TOKEN` is empty. With Docker, note
that Compose reads it from the **host's `.env`** by interpolation
(`ADMIN_TOKEN: ${ADMIN_TOKEN:-}`), so the variable must be in the `.env` next to
`compose.yaml`.

**Browser mode hangs or Chromium dies on heavy pages.**
`/dev/shm` too small. With Docker, `shm_size: '1gb'` is already in
`compose.yaml`; if you run the image by hand, pass `--shm-size=1g`.

**The progress bar does not move until the run finishes.**
A proxy is buffering the SSE stream. See
[Behind a reverse proxy](#behind-a-reverse-proxy).

**Everyone gets rate-limited at once behind a proxy.**
`TRUST_PROXY` is `false`, so every request looks like it comes from the proxy.
Same section — and do not "fix" it with `true`.

**A site returns 429 and the crawl slows to a crawl.**
Working as intended. After `THROTTLE_CIRCUIT_BREAKER_THRESHOLD` consecutive 429s
that host's minimum interval is multiplied for a cooldown period. Other hosts are
unaffected. If the site sends `Retry-After`, that wins, capped by
`HTTP_RETRY_429_MAX_DELAY_MS` so an hour-long value cannot stall the run.

**"It stopped early and the results look incomplete."**
It hit a safety cap (`CRAWL_MAX_PAGES`, `CRAWL_MAX_DURATION_MS`,
`SCROLL_MAX_ROUNDS`…). The interface says so explicitly when this happens,
precisely so that a truncated list is never mistaken for a complete one.

**Nothing resolves / every host is blocked.**
`SECURITY_BLOCK_PRIVATE_ADDRESSES` is doing its job. Inside Docker, "private"
includes the host network and the other containers. Only disable it against
local fixtures.

---

## Architecture

### The shape of a request

```
Browser  ──  public/  (no bundler, no framework, hash-routed views)
   │
   │  POST /api/scrape        ·  GET /api/scrape/stream (SSE)
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ server.js      startup and orderly shutdown only (~45 lines)         │
│ src/app.js     Express app, CSP and headers                          │
│                                                                      │
│ middleware/    rateLimit → adminAuth → (route) → errorHandler        │
│                                                                      │
│ routes/        scrape · video · thumbnail · admin · index            │
│   HTTP shape only: parse, validate, stream, map AppError → status    │
│                          │                                           │
│ services/      the actual work                                       │
│   scraper.js      phase 1 and phase 2                                │
│   pagination.js   ONE STRATEGY PER MODE  ← the extension seam        │
│   detector.js     proposes a configuration from a URL                │
│   jobs.js         paused runs — the ONLY server-side state           │
│   profiles.js     reads/writes data/profiles.json                    │
│   thumbnails.js   downloads and caches thumbnails IN MEMORY          │
│   video.js        single-URL analysis                                │
│   extensions.js   safe loader for per-site modules                   │
│                          │                                           │
│ lib/           reusable, dependency-light pieces                     │
│   http · browser · throttle · ssrf · dedupe · pattern · relevance    │
│   license · media · blocking · concurrency · document · format       │
│   errors · logger · url                                              │
│                          │                                           │
│ config/index.js  EVERY constant, every env var, one source of truth  │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
Target site  ──  always through lib/http.js (SSRF-checked, throttled, retried)
```

### The two phases

```
PHASE 1 — collect                          PHASE 2 — inspect  (optional)
walks the pagination, accumulates links    visits each link, finds files

sequential by design: whether to fetch     a real worker pool: as soon as a
page N+1 depends on what page N            worker finishes a URL it takes the
returned, so there is nothing to           next one, instead of waiting for a
parallelise                                whole batch to drain

stops when: pages run out · a page         duration and size are read from the
yields no links · the link cap is hit      HTML already downloaded — never with
· the client cancels                       extra requests
```

Phase 2 is skipped entirely when no extensions are requested: if all you want is
the list of links, nothing else runs.

### The design decisions that shape the code

**One strategy per pagination mode, not nested conditionals.**
`services/pagination.js` resolves the mode in a fixed order — `scroll` if the
client asked for it, `plantilla` if the URL contains `{page}`, `parametro` if a
page parameter was given, otherwise `unica` — and each mode is its own strategy.
A template inside the URL beats a page parameter on purpose: it is the thing the
user typed deliberately.

**`listarPagina()` is the extension seam.** It is the only function that knows
where a page's links come from, which is exactly why per-site extensions plug in
there: an extension implementing `listar` replaces it, and the traversal code
does not change by a single line.

**Every constant lives in `src/config/index.js`.** Nothing is hard-coded in a
service. Adding an option means adding it there **and** to `.env.example` — the
second is what makes it discoverable rather than folklore.

**No `innerHTML` anywhere in `public/`.** Enforced by ESLint through
`no-restricted-properties`. It is what closed an XSS and what stops it coming
back.

**No bundler on the frontend.** Deployment is `npm start` with no pipeline, and
without a bundler the app can serve a strict CSP with no `unsafe-inline`.

**What downloads and what filters are separate.** The form decides what gets
fetched; the controls inside the results card decide what is displayed of what
was already fetched. When those were mixed, nobody could tell which control did
which — and re-crawling to change a filter is unforgivable.

**Nothing is discarded silently.** Duplicates are grouped and can be expanded,
approximate sizes are marked with `~`, a scroll cut short by a cap says so, and
a result with unknown duration is never removed by the duration slider.
Filtering on data you do not have can only throw away good results.

### State: there is almost none, and that is the design

| What | Where it lives | Survives a restart? |
| --- | --- | --- |
| Saved configurations | `data/profiles.json` | **Yes** — the only thing on disk |
| Paused explorations | Memory (`services/jobs.js`), with a TTL and a cap | No |
| Thumbnail cache | Memory (`services/thumbnails.js`) | No |
| Results | Nowhere — they live in the browser tab that ran them | No |

Paused runs are the **only** server-side state, and they exist for one concrete
reason: resuming requires remembering which links were still pending, and there
can be thousands of them — they do not fit in the query string of an SSE `GET`.
So the registry keeps the minimum, with an expiry, an entry cap that evicts the
oldest, and a periodic sweep.

Keeping it in memory is a deliberate trade: a restart between pausing and
resuming loses the pending work. The alternative — persisting it — would mean
writing the names of the sites you explored to disk, and then having to decide
how long to keep them and how to clean them up. The same reasoning keeps
thumbnails and results off the disk.

### Security architecture

Three mechanisms carry the weight, and each closes a specific hole:

**SSRF validation happens at DNS lookup, not on the URL.** `guardRedirect`
re-validates every redirect, but with a *synchronous* shape check that cannot
resolve DNS — so a perfectly-shaped public host redirecting to one that resolves
to `127.0.0.1` sails straight through it. The real guard is `secureLookup` in
`lib/ssrf.js`, installed on the HTTP/HTTPS agents: it validates the IP **at
connect time**. That is the single point every first request, every redirect and
every real resolution passes through, so there is no window left — and it also
closes DNS rebinding, which existed because the URL was resolved once for
validation and then resolved *again* by the HTTP client.

**`trust proxy` defaults to `false` and must never be `true`.** `true` does not
mean "I am behind a proxy", it means "trust anybody". Since `req.ip` comes from
`X-Forwarded-For` and rate limiting keys off `req.ip`, `true` lets a client
rotate that header and bypass the limit entirely — measured: 0 blocks in 40
requests, against 10 of 40 from the same IP. The serious part is not
`/api/health`; it is that the same mechanism is the only brute-force protection
on `/api/admin/unlock`. That unlock limiter additionally identifies clients by
the **real socket address**, ignoring the header, because a password-attempt
counter must not depend on a network setting.

**Loading an extension means executing code, so nothing untrusted may reach a
`require`.** The extensions directory is fixed, resolved from `__dirname` and
deliberately **not** configurable by environment. The loader *enumerates* the
directory and never builds a filename from a request; there is an allowlist as a
second barrier; loading happens once at startup with no hot reload. Adding an
extension means adding reviewed code to the repository, with its commit. If
user-supplied rules were ever needed, the answer is a declarative format
interpreted by the core — not executable code.

Two smaller ones worth knowing: without `ADMIN_TOKEN`, `/api/admin/*` answers
**404 rather than 401**, because a 401 announces that a door exists; and
`/api/health` mentions neither the admin mode nor which extensions are loaded,
since an extension's name is a site's name.

### Being a good citizen of the sites it crawls

`lib/throttle.js` enforces a minimum interval and a concurrency cap **per
host**, so one slow site cannot starve another. On repeated 429s a circuit
breaker multiplies that host's interval for a cooldown period; a `Retry-After`
header wins over the computed delay, capped so that an hour-long value cannot
stall a run. `lib/blocking.js` watches for anti-bot signals in both phases —
including the ones that arrive inside a rejected 4xx rather than through the
normal path — and reports them as *suspicion*, never as diagnosis.

### Known limits, stated rather than hidden

- **The detector guesses well, not always.** It is presented as an editable
  suggestion on purpose: presented as automatic, every miss would read as a
  breakage.
- **Duplicate grouping compares within a single exploration only.** Across
  searches it would need content fingerprints and state between runs.
- **Rate limiting is in-memory**, so it does not hold across multiple instances.
- **The ReDoS guard is a time budget, not static analysis.** A JavaScript regex
  is synchronous and cannot be interrupted mid-match; the nested-quantifier
  filter only inspects parentheses, so it does not catch every pathological
  pattern. Detecting this in general is undecidable.
- **Infinite scroll has no automated test** — it needs a real browser. It was
  verified by hand against a fixture that grows as you scroll, all three caps
  included. If you touch `renderPageWithInfiniteScroll`, repeat that check.
- **There is no CI.** `npm run check` exists; nothing runs it automatically.

## Project layout

```
server.js              Entry point — Express wiring only
src/
  config/index.js      Every env var, with its default. Single source of truth.
  routes/              HTTP layer: scrape, video, thumbnail, admin
  services/            The actual work — scraper, pagination, detector,
                       jobs (pause/resume), profiles, thumbnails, video
  lib/                 Reusable pieces: http, browser, throttle, ssrf,
                       dedupe, pattern, license, media, relevance, url…
  middleware/          adminAuth, rateLimit, errorHandler
  extensions/          Drop-in point for custom extractors (see its README)
public/                Frontend — no build step, plain JS
  js/views/            explorer, video, and their options panels
  js/components/       dialog, progress, resultList, rangeSlider, profiles
  js/i18n/             engine + es / en dictionaries
tests/                 31 files, 500 tests, node:test
data/                  Runtime state (gitignored)
```

```bash
npm test           # 500 tests, ~30 s
npm run check      # lint + format check + tests — run this before committing
npm run lint:fix   # autofix
```

No build step and no framework on the frontend: `public/` is served as-is, and
views are routed by hash. Adding a config option means adding it to
`src/config/index.js` **and** to `.env.example` — the second is what makes it
discoverable.

---

## Responsible use

**What this is.** A generic tool for walking paginated listings and collecting
links — the same thing you do by hand clicking "next page", automated. It sends
plain HTTP requests (or renders a page with a normal browser, when you turn
that on) to URLs *you* provide. It ships with no list of targets, does not seek
out sites on its own, and does not bypass logins, paywalls, CAPTCHAs or any
other access control. If a site doesn't serve something to an anonymous
visitor, this tool doesn't see it either.

**Your responsibility, not this tool's.** Whether it's legal to access, save or
redistribute what you find is a question about the *site* and about *your
jurisdiction* — a pagination crawler is legally neutral in the same way a
browser or `curl` is. Running it means you are responsible for:

- Having the right to access the content you point it at.
- Respecting the target site's terms of service and its `robots.txt`.
- Complying with copyright law wherever you are and wherever the site is.
- Not using it to download, copy or redistribute copyrighted material you have
  no rights to.

Keep the throttling defaults in place, too — they exist so a run doesn't hammer
the site you point it at, independently of whether you're allowed to be there.

**No content, no hosting, no endorsement.** URL Explorer doesn't host, cache or
redistribute anything it finds — see [Data and backups](#data-and-backups):
results live only in the browser tab that produced them, and export is a
manual, deliberate action from that tab. Nothing it surfaces is curated,
recommended or vetted by the author, and the author has no visibility into what
any given self-hosted instance is pointed at.

**The license filter is a convenience, not a legal opinion.** It can restrict
results to material that *declares* an open license (Creative Commons, public
domain), based on metadata the target site itself publishes — it can only be as
accurate as that metadata. The absence of a declared license means "all rights
reserved" by default, never "free to use", and a mislabeled site can still slip
through the filter.

**No warranty.** Provided "as is", with no warranty of any kind — see
[License](#license). Using this against a site you're not authorized to access,
or to acquire material you have no rights to, is your decision and your
liability, not the author's.

---

## License

[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html): free to use,
self-host and modify, including commercially. The one obligation: if you
distribute a modified version — including running it as a network service
for others — you must make that version's source available under the same
license. Full text in [`LICENSE`](LICENSE).
