<div align="center">

<img src="public/img/logo.png" alt="" width="96" height="96" />

# URL Explorer

**Point it at a paginated website. Walk away with a clean, deduplicated list of
everything that matched.**

A self-hosted web app that does the "next page" clicking for you: tell it where
to start, how the site paginates and what you are looking for, and it walks the
pages, opens each result and hands you back the files it found — with live
progress, real cancellation and export.

![Node](https://img.shields.io/badge/node-%E2%89%A520-informational)
![Docker](https://img.shields.io/badge/docker-compose-informational)
![License](https://img.shields.io/badge/license-AGPL--3.0-informational)

</div>

> ⚠️ URL Explorer only reads what a site already serves to a normal visitor —
> it does not bypass logins, paywalls, CAPTCHAs or DRM. Whether you may access,
> save or redistribute what you find depends on the site and your jurisdiction,
> and that responsibility is yours. See [Responsible use](#responsible-use).

## Contents

- [Features](#features)
- [Install with Docker](#install-with-docker)
- [Configuration](#configuration)
- [Updating and backups](#updating-and-backups)
- [Exposing it on the internet](#exposing-it-on-the-internet)
- [Install without Docker](#install-without-docker)
- [How to use it](#how-to-use-it)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Responsible use](#responsible-use) · [License](#license)

---

## Features

- **Two phases**: walk the pagination collecting the links that match a
  pattern, then (optionally) open each link and find files by extension.
- **Any pagination**: `?page=2`, templates in the URL (`/page/{page}`,
  `{page:02}`) and **infinite scroll**.
- **Auto-detection**: paste a results URL and it proposes the pattern,
  pagination and extensions, explaining each guess.
- **Saved configurations**: name a setup, load it later from any device, or
  copy a link that opens the app with everything filled in.
- **Optional browser rendering** (bundled Chromium) for sites built with
  JavaScript.
- **Useful results**: duration and size per file, range filters, duplicate
  grouping, thumbnails, pause and resume, CSV / JSON / plain-list export.
- **Single-page analyzer**: inspects one URL in depth (DOM, network requests,
  embedded players, scripts).
- **Safe to run**: SSRF protection, per-host throttling, rate limiting, memory
  and time caps. English and Spanish interface.

---

## Install with Docker

This is the recommended way. You need **Docker with Docker Compose** and about
**1.5 GB of free RAM** if you plan to use browser rendering (much less without
it).

```bash
git clone https://github.com/lucasfrattini/urlexplorer.git
cd urlexplorer
cp .env.example .env     # optional: defaults work as they are
docker compose up -d --build
```

Open **http://localhost:3001** (or `http://<server-ip>:3001` from another
machine). That's it.

The container restarts by itself after a crash or a reboot. Everyday commands,
run from the `urlexplorer` folder:

```bash
docker compose logs -f         # follow the log
docker compose restart         # restart
docker compose down            # stop
docker compose up -d --build   # start again / apply changes
```

> Always use `--build` after pulling new code: without it Docker keeps running
> the old image.

---

## Configuration

Everything is optional and lives in `.env`, which is created from
`.env.example`, where every option is documented with its default. After
editing it, apply the change with `docker compose up -d`.

The ones you are most likely to touch:

| Variable                  | Default   | What it does                                                                |
| ------------------------- | --------- | --------------------------------------------------------------------------- |
| `HOST_PORT`               | `3001`    | Port the app is published on                                                |
| `BROWSER_ENABLED`         | `true`    | Allow browser rendering. Set `false` on small machines                      |
| `BROWSER_POOL_SIZE`       | `2`       | Browser tabs at once (each one costs a few hundred MB)                      |
| `CRAWL_MAX_PAGES`         | `50`      | Maximum pages per exploration                                               |
| `CRAWL_MAX_DURATION_MS`   | `600000`  | Maximum duration of one exploration (10 min)                                |
| `RATE_LIMIT_MAX_REQUESTS` | `30`      | API requests per minute per client                                          |
| `SECURITY_ALLOWED_HOSTS`  | _(empty)_ | Restrict crawling to these hosts (comma-separated)                          |
| `TRUST_PROXY`             | `false`   | Set when behind a reverse proxy — see [below](#exposing-it-on-the-internet) |

**Saved configurations** are stored on the server in `data/profiles.json`, so
they are shared by everyone who opens your instance. A fresh install starts
with none.

---

## Updating and backups

```bash
cd urlexplorer
git pull
docker compose up -d --build
```

Your saved configurations survive updates. The only things worth backing up
are two small files:

```bash
cp data/profiles.json .env ~/backups/
```

Results are never written to disk — they live in the browser tab that ran the
exploration, so export them if you want to keep them. Paused explorations are
kept in memory and are lost on restart.

---

## Exposing it on the internet

URL Explorer has **no login**: anyone who can reach it can use it and see or
change the saved configurations. On a home or office network that is fine. If
you open it to the internet, put it behind a reverse proxy with authentication
(basic auth, an SSO proxy) or behind a VPN such as Tailscale or WireGuard.

Behind a reverse proxy, set `TRUST_PROXY` in `.env` to the proxy's IP address
as the app sees it. Never set it to `true`: that lets any client fake its IP and
skip the rate limit.

Minimal nginx example — the last two lines matter, or the progress bar freezes
until the exploration ends:

```nginx
location / {
    proxy_pass         http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header   Host            $host;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering    off;
    proxy_read_timeout 3600s;
}
```

---

## Install without Docker

Needs **Node.js 20 or newer**. Puppeteer downloads its own Chromium during
`npm install`.

```bash
git clone https://github.com/lucasfrattini/urlexplorer.git
cd urlexplorer
npm install
cp .env.example .env
npm start
```

It listens on `PORT` from `.env` (default **http://localhost:3000**). To keep it
running after you log out, use a process manager such as systemd or pm2.

---

## How to use it

1. **Addresses to explore** — the page where the walk starts. You can use
   `{q}` where the search term goes and `{page}` where the page number goes.
   Not sure? Press **Set it up for me** and review what it proposes.
2. **Link pattern** — which links you care about. Plain text (`/videos/`) or a
   regular expression between slashes (`/\/videos\/\d+/`). Empty takes all.
3. **File extensions** — comma-separated (`mp4, jpg`). Empty skips the second
   phase and just lists the links.
4. **Pages** — how far to go. For sites that load more as you scroll, pick the
   _scroll_ mode in the advanced options (it needs browser rendering).

Press **Save** to keep the setup for later. Filters inside the results card
work on what was already found and never start a new crawl.

---

## Troubleshooting

**Saving a configuration fails.** The container runs as user id 1000 and
must be able to write to the `data/` folder. If your user has another id, run
`sudo chown 1000:1000 data` once.

**Browser mode hangs or Chromium crashes.** Not enough memory. Lower
`BROWSER_POOL_SIZE`, add swap, or set `BROWSER_ENABLED=false`.

**The progress bar does not move until the end.** A reverse proxy is buffering
— add `proxy_buffering off` (see above).

**Everyone gets "too many requests" behind a proxy.** Set `TRUST_PROXY` to the
proxy's address.

**It stopped early.** It reached a safety cap such as `CRAWL_MAX_PAGES` or
`CRAWL_MAX_DURATION_MS`; the interface says which. Raise it in `.env`.

**A site keeps answering 429 and it slows down.** Intended: it backs off from
that site automatically to avoid hammering it.

**Local addresses are blocked.** SSRF protection prevents crawling private or
loopback addresses, on purpose.

---

## Development

```bash
npm install
npm run dev      # auto-reload
npm run check    # lint + formatting + tests — run before committing
```

No build step and no framework: `public/` is served as-is. How the code is
organised, the API and the design decisions are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Per-site extractors go in
`src/extensions/` (see [its README](src/extensions/README.md)).

---

## Responsible use

URL Explorer is a generic tool: it automates what you would do by hand clicking
"next page", sending plain HTTP requests (or rendering with a normal browser)
to URLs **you** provide. It ships with no list of targets and does not get past
any access control.

By running it, you are responsible for:

- having the right to access the content you point it at;
- respecting the site's terms of service and its `robots.txt`;
- complying with copyright law, and not downloading or redistributing material
  you have no rights to.

Keep the throttling defaults so a run does not overload the sites you explore.
The open-license filter relies on what the site declares and is not legal
advice. The software stores no results and the author has no visibility into
what any instance is used for. It is provided "as is", without warranty.

---

## License

[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html): free to use,
self-host and modify, including commercially. If you distribute a modified
version — including running it as a network service for others — you must
publish that version's source under the same license. Full text in
[`LICENSE`](LICENSE).
