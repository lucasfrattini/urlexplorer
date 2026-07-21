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
![Tests](https://img.shields.io/badge/tests-413-success)

</div>

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
- 413 tests, ESLint and Prettier.

---

## Requirements

- **Docker** and Docker Compose _(recommended)_, **or**
- **Node.js ≥ 20** and npm

Browser mode uses Chromium. The Docker image already includes it; on a local
install Puppeteer provides it.

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

## Configuration

Everything is set through environment variables. `.env.example` documents every
option with its default; only `PORT` is required to boot.

The most relevant ones:

| Variable                           | Default   | Purpose                                       |
| ---------------------------------- | --------- | --------------------------------------------- |
| `PORT`                             | `3000`    | Server port                                   |
| `ADMIN_TOKEN`                      | _(empty)_ | Unlocks saved configurations (see below)      |
| `CRAWL_MAX_PAGES`                  | `50`      | Maximum pages per exploration                 |
| `CRAWL_MAX_FILES`                  | `5000`    | Cap on files held in memory                   |
| `CRAWL_MAX_DURATION_MS`            | `600000`  | Maximum duration of one exploration           |
| `BROWSER_ENABLED`                  | `true`    | Allow browser mode                            |
| `BROWSER_POOL_SIZE`                | `2`       | Concurrent browser tabs                       |
| `THUMBNAILS_ENABLED`               | `true`    | Serve thumbnails through `/api/thumbnail`     |
| `SCROLL_MAX_ROUNDS`                | `50`      | Maximum loads in infinite-scroll mode         |
| `SCROLL_MAX_DURATION_MS`           | `120000`  | Time cap for the scrolling phase              |
| `SCROLL_MAX_ELEMENTS`              | `3000`    | Accumulated links at which scrolling stops    |
| `THROTTLE_MIN_INTERVAL_MS`         | `250`     | Minimum gap between requests to the same host |
| `THROTTLE_MAX_CONCURRENT_PER_HOST` | `4`       | Concurrent requests per host                  |
| `SECURITY_BLOCK_PRIVATE_ADDRESSES` | `true`    | SSRF protection                               |
| `SECURITY_ALLOWED_HOSTS`           | _(empty)_ | Optional host allowlist                       |
| `RATE_LIMIT_MAX_REQUESTS`          | `30`      | Requests per window                           |
| `ADMIN_UNLOCK_MAX_ATTEMPTS`        | `5`       | Unlock attempts per minute                    |

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
