# ST Explorer

[![version](https://img.shields.io/badge/version-v0.9.9-orange)](https://github.com/LYC619/st-explore/releases)
[English](README.md) · [简体中文](README.zh-CN.md)

**A personal library for your SillyTavern characters and stories.** Collect cards, revisit conversations, organize lorebooks and presets, and continue a scene from the same workspace.

ST Explorer is an independent community project for SillyTavern roleplayers.

## What you can do

- Browse character cards in a gallery, with tags, ratings, portraits, and linked stories.
- Read and edit chat histories, explore branches, mark chapters, and collect favorite moments.
- Organize lorebooks, presets, regular expressions, and related assets.
- Continue chats through an embedded, pinned SillyTavern frontend using your own AI provider.
- Switch the interface between English and Simplified Chinese while keeping your cards, conversations, names, custom tags, and writing prompts in their original language.

World simulation and GAL-style play are experimental features.

## Choose your platform

| Platform | Storage and workflow |
| --- | --- |
| Windows desktop (Tauri) | Full local-folder workflow; choose your own library directory on disk. |
| Self-hosted web | Browser storage isolated per origin and browser profile. Host at the origin root (`/`). |
| Android (Capacitor) | Experimental mobile project available in source. |
| GitHub Pages | Static bilingual introduction and getting-started guide. |

## Start locally

Requires Node.js 22 and npm. The pinned tavern frontend is prepared automatically on first run.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite, then see the [usage guide](docs/USAGE.md) for importing cards, reading stories, continuing chats, and backups. For Windows desktop builds, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) before running `npm run tauri:dev` (automated native test runs should follow [native test isolation](docs/guides/native-test-isolation.md)).

## Build and deploy

```sh
# Full browser app + /about/ public pages (omit --site-url for local/intranet builds)
npm run deploy:prepare -- --target app --site-url https://library.example.org/

# Standalone bilingual overview & guide (supports a repository subpath)
npm run deploy:prepare -- --target pages --site-url https://your-name.github.io/st-explore/
```

Outputs `dist/` or `site-dist/` along with `deployment.json` and `SHA256SUMS`. See the [deployment guide](docs/DEPLOYMENT.md) for Docker Compose, Nginx, GitHub Pages, and upgrades.

## Privacy and backups

Desktop libraries live in plain local folders; browser libraries stay in the current browser's IndexedDB, with no built-in cloud account or automatic sync. Scanning and importing SillyTavern directories is read-only, while working copies, exports, and writebacks remain separate actions. AI requests go directly to the provider you configure.

Export regular backups in `Settings → Data & backups`, and keep separate copies of desktop library folders.

## Development and community

```sh
npm run i18n:check
npm run verify:web
npx playwright test --config=playwright.production.config.ts
```

- [Contributing](CONTRIBUTING.md) · [Translation guide](docs/I18N.md)
- [Support](SUPPORT.md) · [Security reporting](SECURITY.md)
- [Architecture and guides](docs/guides/) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Licensed under [AGPL-3.0-only](LICENSE).
