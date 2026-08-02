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

---

## Contents

- [What it is](#what-it-is) · [Features](#features)
- **Getting it running** — [Requirements](#requirements) ·
  [Installation](#installation) · [Updating](#updating) ·
  [Behind a reverse proxy](#behind-a-reverse-proxy)
- **Running it** — [Configuration](#configuration) · [Usage](#usage) ·
  [Data and backups](#data-and-backups) · [Troubleshooting](#troubleshooting)
- **Working on it** — [API](#api) · [Project layout](#project-layout)
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
found inside scripts.

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

## Project layout

```
server.js              Entry point — Express wiring only
src/
  config/index.js      Every env var, with its default. Single source of truth.
  routes/              HTTP layer: scrape, video, thumbnail, admin
  services/            The actual work — scraper, pagination, detector,
                       jobs (pause/resume), profiles, thumbnails, video
  lib/                 Reusable pieces: http, browser, throttle, ssrf,
                       dedupe, pattern, license, media, url…
  middleware/          adminAuth, rateLimit, errorHandler
  extensions/          Drop-in point for custom extractors (see its README)
public/                Frontend — no build step, plain JS
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

This tool sends requests to third-party websites. Use it on sites you are
allowed to access, respect their terms of service and their `robots.txt`, and
keep the throttling defaults in place — they exist so that a run does not hammer
the site you point it at.

The license filter can restrict results to material that declares an open
license (Creative Commons, public domain), based on the metadata the site itself
publishes. Note that the absence of a license means "all rights reserved", not
"free to use".

---

## License

[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html): free to use,
self-host and modify, including commercially. The one obligation: if you
distribute a modified version — including running it as a network service
for others — you must make that version's source available under the same
license. Full text in [`LICENSE`](LICENSE).
