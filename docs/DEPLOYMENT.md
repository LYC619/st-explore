# Deploy ST Explorer

[简体中文](DEPLOYMENT.zh-CN.md) · [Usage](USAGE.md)

Requires Node.js 22 and `npm ci`. Keep API keys and personal library files out of the repository and Docker build context.

## Full web app

```sh
# Public HTTPS origin (omit --site-url for local/intranet self-hosting)
npm run deploy:prepare -- --target app --site-url https://library.example.org/
```

The web app must be hosted at the origin root (`/`), as its routes, embedded tavern assets, manifest, and service worker resolve from `/`.

Deploy the entire `dist/` directory together as one release:
- `/` serves the workspace (`noindex, nofollow`).
- `/about/en/` and `/about/zh-CN/` (plus `guide/` under each) serve static overview and getting-started pages. When `--site-url` is supplied, canonical links, `hreflang`, and `sitemap.xml` are generated automatically.
- `deployment.json` and `SHA256SUMS` record build metadata and file checksums (`sha256sum -c SHA256SUMS`).

Use the included `nginx.conf` (or equivalent rules on your reverse proxy): SPA workspace routes fall back to `/index.html`, missing static files and unknown `/about/` paths return `404`, content-hashed `/assets/` files use `immutable` caching, and HTML / service worker / unhashed tavern files revalidate. Add authentication at your reverse proxy if exposing a server publicly.

## Docker Compose

```sh
docker compose up --build -d
```

By default Compose binds `127.0.0.1:8080` (`STE_PORT` overrides the host port) and builds without a canonical public URL. When publishing behind an HTTPS reverse proxy, pass `STE_SITE_URL=https://library.example.org/` at build time. `/healthz` provides an HTTP health check, and browser library data stays on each client device rather than in a container volume.

## GitHub Pages (public overview & guide)

1. In repository **Settings → Pages**, set the source to **GitHub Actions**.
2. Run the **Public documentation (manual)** workflow. It reads the Pages base URL from `configure-pages`, builds `site-dist/` only, and deploys the bilingual overview and guide.

To generate the same static site locally (subpaths supported):

```sh
npm run deploy:prepare -- --target pages --site-url https://your-name.github.io/st-explore/
```

For a quick local preview without a target URL, run `npm run site:build`.

## Upgrades and rollback

1. Export a backup in **Settings → Data & backups** before upgrading, and retain the previous `dist/` directory.
2. Build a fresh release, verify `SHA256SUMS`, and switch the served directory atomically so hashed and unhashed assets stay in sync.
3. Save open edits before accepting the in-app update refresh toast. If a new build fails to start, point the web server back to the previous release directory.
