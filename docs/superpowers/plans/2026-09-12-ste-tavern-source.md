# STE pinned Tavern frontend source implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. The user explicitly limited concurrency; execute inline without additional agents. Steps use checkbox syntax for tracking.

**Goal:** Deliver the genuine, pinned TauriTavern/SillyTavern frontend and its original library bundles through STE's existing Vite development and production builds.

**Architecture:** Keep the upstream frontend byte for byte in `vendor/tauritavern`, with per-file SHA-256 provenance. A Node build wrapper reuses the original Rspack configurations with root-installed dependencies and relocates output/cache directories. A Vite plugin serves only manifest-listed assets and copies the same assets into production without replacing STE documents or public files.

**Tech stack:** Node 22.14.0, npm/package-lock, original Rspack 2.0.8, Vite 8, Node's test runner, SHA-256.

---

## Ownership and boundaries

The existing worktree is `D:/8.Project/0_0_维护/silly-tavern-explorer-main/.claude/worktrees/ste-roleplay`, branch `codex/ste-roleplay-runtime`. The upstream checkout is `_reference/projects/tauritavern`, repository `https://github.com/Darkatse/TauriTavern.git`, commit `9693a4ec47cd4552f90878bccab453f176de0f18`, `src` tree `6afe13fd10ac80a3ee5d3cafb53d75100bf96013`. Package version is 2.2.0 and `src/compat-version.js` records SillyTavern compatibility 1.18.0.

This task owns `vendor/tauritavern/**`, `scripts/tavern/**`, this plan and source documentation, root package/lock and Vite tooling configuration. It does not modify React pages or `src/lib/tavern/**`, implement a native backend, migrate user data, enable an Agent, or claim the original bootstrap works in STE yet. The baseline provided by the parent is 170 test files / 1,581 tests passing after `npm ci`; repeat focused checks rather than that entire suite.

## File map

| Path | Responsibility |
| --- | --- |
| `vendor/tauritavern/src/**` | Untouched upstream HTML, raw modules, CSS, locales, fonts and images |
| `vendor/tauritavern/default/content/**` | Original read-only startup defaults for the later STE host; never served by this static map |
| `vendor/tauritavern/{LICENSE,package.json,pnpm-lock.yaml,rspack.config.js}` | Original license and build inputs |
| `vendor/tauritavern/{UPSTREAM.json,SOURCE-MANIFEST.json,README.ste.md,.gitattributes}` | Pin, original hashes, update instructions, byte-preserving checkout |
| `scripts/tavern/source.mjs` | Manifest validation, safe pinned reads and explicit URL mapping |
| `scripts/tavern/source.test.mjs` | Provenance, safe lookup, tamper and traversal contracts |
| `scripts/tavern/build.mjs` | Original Rspack config wrapper, root lock validation and generated asset manifest |
| `scripts/tavern/cache.mjs`, `cache.test.mjs` | Project-anchored cache directory preparation, compiler ancestry rechecks and link-escape regression tests |
| `scripts/tavern/prepare.mjs` | CLI to prepare or verify frontend inputs |
| `scripts/tavern/delivery.mjs` | Guarded HTTP middleware and exclusive production copy |
| `scripts/tavern/delivery.test.mjs` | Real filesystem/HTTP collision and disclosure checks |
| `scripts/tavern/vite-plugin.mjs`, `vite-plugin.d.mts` | Vite lifecycle integration and TypeScript declaration |
| `scripts/tavern/build.test.mjs` | Upstream config adaptation, dependency pin and generated artifact contracts |
| `.cache/tavern/**` | Ignored generated bundles, build manifest and Rspack cache |
| `vite.config.ts`, `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.js` | Root integration, locked build dependencies, narrow tooling exceptions |

## Task 1: Source and provenance contract

- [x] Write failing Node tests importing `loadPinnedSource`, `lookupAsset`, `readAsset` and `sourceAssetEntries` from `scripts/tavern/source.mjs`. Use the actual pinned source for provenance tests and temporary directories for hostile paths and modified bytes.

```js
test('keeps the original app document and raw ESM together', async () => {
  const source = await loadPinnedSource(projectRoot);
  const assets = sourceAssetEntries(source);
  const html = await readAsset(lookupAsset(assets, '/tavern.html'));
  assert.match(html.toString(), /<base href="\/">/);
  assert.match(html.toString(), /src="init\.js"/);
  assert.ok(lookupAsset(assets, '/script.js'));
  assert.equal(lookupAsset(assets, '/index.html'), null);
  assert.equal(lookupAsset(assets, '/scripts/../../package.json'), null);
});
```

- [x] Run `node --test scripts/tavern/source.test.mjs`; confirm the contract fails because source support is absent.
- [x] Export only `src`, `default/content`, `LICENSE`, `package.json`, `pnpm-lock.yaml`, and `rspack.config.js` from the exact commit with `git archive`, then extract into `vendor/tauritavern`. Do not copy Rust, git metadata, node_modules, or native launch scripts. The parent added `default/content` after confirming genuine startup presets/settings are required for the next host-bootstrap task; this subset is hashed but never added to the served asset map.
- [x] Record a sorted `SOURCE-MANIFEST.json` with `{path, sha256, size}` for every exported file. `UPSTREAM.json` records repository, commit, tree, package/version, compatible ST version, subset and source-manifest hash. `.gitattributes` uses `* -text` inside the vendor directory so Git cannot normalize pinned bytes.
- [x] Implement safe manifest reads. Reject non-relative paths, dot segments, encoded traversal, backslashes, control characters, Windows drive forms and files whose real path leaves their approved root. Validate every source hash before preparing, and each asset hash before delivery. Serve entries only from the manifest.
- [x] Map `src/index.html` to `/tavern.html`, `src/favicon.ico` to `/tavern-favicon.ico`, and `src/manifest.json` to `/tavern.webmanifest`; omit `src/robots.txt`. Only the generated HTML rewrites the two matching favicon/manifest attributes. Root STE `/index.html`, `/favicon.ico`, `/manifest.json`, `/robots.txt`, `/sw.js` and existing public assets retain ownership. Keep the upstream manifest at the origin root so its relative `img/` URLs still resolve correctly.
- [x] Run the source test file; require all source, pin, manifest and hostile lookup checks to pass.

## Task 2: Original reproducible bundle preparation

- [x] Add failing tests for config relocation and dependency compatibility. The wrapper must preserve original entries, plugins, targets and deterministic optimization while setting a vendor context and generated output/cache locations.

```js
assert.equal(adapted.context, vendorRoot);
assert.equal(adapted.entry['lib.core'], './src/lib-bundle-core.js');
assert.equal(adapted.output.path, join(cacheRoot, 'bundles', 'dist'));
assert.equal(adapted.output.module, true);
assert.equal(adapted.optimization.moduleIds, 'deterministic');
```

- [x] Run `node --test scripts/tavern/build.test.mjs`; confirm failure before implementation.
- [x] Add only the required Rspack core and frontend bundle dependencies at the versions resolved by upstream `pnpm-lock.yaml`. Reuse STE's existing `fflate` when it matches. Run root `npm install --ignore-scripts --no-audit --no-fund` to update/install the lock; no nested installation.
- [x] Load the original `rspack.config.js` and adapt `context`, `output.path`, and cache storage. Generate all original bundle groups (vendor libs, Agent assets, settings assets) without enabling those features. Use Rspack's emitted asset list to record generated hashes. Include source-manifest digest, root package-lock digest, wrapper digest, Node/platform and Rspack version in the preparation fingerprint.
- [x] Reuse a prepared cache only after checking its fingerprint and every generated output hash. A clean root build regenerates missing/stale bundles. An explicit verify-only CLI validates vendored source without generating output.
- [x] Add `tavern:prepare`, `tavern:verify`, and `test:tavern-source` npm commands. Root dev/build integration is owned by the Vite plugin in Task 3.
- [x] Run the focused build and source tests. Run `npm run tavern:prepare`; expect original core/optional library, Agent and three settings bundles plus `.cache/tavern/build-manifest.json`.

## Task 3: Safe Vite delivery and production copying

- [x] Write failing filesystem/HTTP tests: exact manifest lookup preserves bytes and MIME type; HEAD returns no body; unknown reserved paths return 404; traversal and direct vendor/cache URLs are refused; existing output collisions fail before copying any asset; symlink/junction escape cannot copy or disclose a file.

```js
await writeFile(join(outputRoot, 'script.js'), 'STE-owned');
await assert.rejects(copyAssets(assets, outputRoot), /collision/i);
assert.equal(await readFile(join(outputRoot, 'script.js'), 'utf8'), 'STE-owned');
await assert.rejects(access(join(outputRoot, 'tavern.html')));
```

- [x] Run `node --test scripts/tavern/delivery.test.mjs`; confirm the missing delivery behavior fails.
- [x] Implement middleware before Vite's ordinary static server. Handle only GET/HEAD, preserve raw upstream ESM instead of Vite transformation, and fail closed for reserved ST directories or protected vendor/cache paths. Unknown ordinary STE paths continue to Vite.
- [x] Implement a preflight of every production destination and its ancestors. Reject case-insensitive duplicate names, file/directory conflicts, output escapes, and any existing file; use exclusive writes so races cannot silently overwrite files.
- [x] Register `tavernFrontend()` in `vite.config.ts`. Its development setup prepares assets, checks public collisions and registers middleware. Its build lifecycle prepares assets then copies them after Vite emits STE's normal output. Ignore vendor/cache for source dependency scanning and ESLint; add only `scripts/tavern/**` tracking exceptions and generated cache ignores.
- [x] Run focused tests. Start Vite with a local test server and check `/`, `/tavern.html`, `/script.js`, `/lib.js`, `/dist/lib.core.bundle.js`, `/css/fontawesome.min.css`, and a denied metadata/traversal route.

## Task 4: Verification, documentation and owned commit

- [x] Finish `vendor/tauritavern/README.ste.md` with exact source/version/license, served URL table, no-upstream-edit policy, export/manifest refresh commands, build cache behavior, and next bootstrap requirements (`init.js -> lib.js -> tauri-main.js -> script.js`, STE host/data bridge still required).
- [x] Run `npm run test:tavern-source`, `npm run tavern:verify`, `npm run build`, `npx tsc --noEmit -p tsconfig.node.json`, and `npx tsc --noEmit -p tsconfig.app.json`. Inspect final output without repeating the unrelated full application suite.
- [x] Compare every original exported file hash and protected STE public asset with its built counterpart; confirm generated bundles and root `dist/index.html` coexist. Verify repeated preparation reuses a validated cache.
- [x] Review `git diff --check`, owned file diff and status. Ensure vendored source is byte-identical, no Rust service/native app is included, and no navigation falsely advertises working chat.
- [x] Stage only the owned paths explicitly and commit as `feat: vendor pinned Tavern frontend and build assets`. Report commit, checks, generated paths, URLs and the remaining native-bootstrap requirement to the parent.

## Progress / evidence

- Worktree detection: linked worktree, correct branch, clean initial status.
- Node: v22.14.0. `rtk` is unavailable per session guidance; use native commands.
- Upstream inspected: original raw HTML/ESM, three Rspack groups, genuine ST 1.18.0 compatibility and TT package 2.2.0.
- Source export: 1,137 original files (946 frontend + 187 default content + four build/license inputs), 35,965,205 bytes. A separate SHA-1 Git-blob comparison matched every file against the pinned commit; SHA-256 manifests also verified.
- Tests-first evidence: source/build/delivery test files failed before their implementations; the added startup-default test failed on the missing subset before it was exported. All 25 focused tests now pass, including tamper, traversal, case collision and Windows junction checks.
- `npm run build` passed and copied 951 verified assets. All copied bytes matched the prepared map, every STE public file stayed identical, and neither the vendor metadata nor default content was published.
- `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.app.json` passed. Vite reports its existing `__dirname` config warning and an upstream SWC recommendation; the source/build task does not change those existing tool choices.
- Real Vite dev smoke passed for original HTML/modules, generated core bundle, CSS and alternate metadata URLs; STE root/public content remained intact and protected/traversal paths returned 404.
- `npm run tavern:verify` verified all original source files; repeated `npm run tavern:prepare` reused six bundles only after validating their hashes.
- The host task can extend the tested `composeAssets()` seam with explicit generated assets and original-hash-checked overrides; no host or chat behavior was implemented here.
- Final diff review found only original upstream whitespace/CR bytes. The vendor attributes retain those exact bytes and exclude only imported paths from whitespace checks; STE-owned files remain checked normally.

## Review correction: compiler cache ancestry

The spec review reproduced a cache junction escaping the project before the existing read/delivery guards ran. Rspack's original `output.clean` deleted an external sentinel, then emitted bundles outside the worktree. This correction owns only the source/build guard, its tests and these source docs; the parent's host-overlay/runtime and package changes remain separate.

- [x] Add real-compiler regression tests for `.cache`, `.cache/tavern`, a nested output junction, and a valid cached manifest behind a junction. Require rejection with the external sentinel and outside directory unchanged.
- [x] Add `scripts/tavern/cache.mjs` and focused tests for a reusable `prepareCacheDirectory(projectRoot, relativePath)` helper. Walk existing ancestors without following links, create missing directories one level at a time, revalidate created directories, and reject unsafe cache entries before any compiler/cache use.
- [x] Validate cache ancestry before reading a reusable manifest and immediately before compiler creation/run/emission. Include generated output and persistent-cache directories. Disable destructive Rspack `output.clean`; only compiler-manifest-listed assets are delivered, so stale cache files need not be deleted.
- [x] Expose the same helper for the parent's upcoming `.cache/tavern/host` writes, and document the same-user filesystem boundary and revalidation requirement.
- [x] Run explicit owned source/build/cache/delivery tests, source verification, build and relevant Node-config type checking. Stage and commit only this correction's files.

Correction evidence: the real-compiler tests first reproduced external sentinel deletion through `.cache` and `.cache/tavern` junctions, lack of rejection for a nested output junction, and acceptance of a valid cached manifest through a junction. The first full-tree compiler-hook approach exposed a normal Windows race: native Rspack snapshots can briefly resolve under `C:\\$Extend\\$Deleted` or return `EPERM` during replacement. The final design uses full checks before compiler creation/cache reads, and ancestry checks at run/emit/close boundaries while native snapshots are active. Missing/changed temporary entries are rechecked, and no resolved outside path is accepted as valid.

- All 40 explicit source/build/cache/delivery tests passed. The real-compiler valid-cache regression also passed three consecutive cold-build runs after the compiler-hook adjustment.
- `npm run build` and `npx tsc --noEmit -p tsconfig.node.json` passed. The build's large-chunk warning belongs to the concurrent host/UI work and requires no source/build change.
- `npm run tavern:verify` verified all 1,137 original files at commit `9693a4ec47cd4552f90878bccab453f176de0f18`. A separate post-build check confirmed `prepareTavern().reused === true` and byte-for-byte preservation of every STE `public/` file in `dist/`.
- This correction stages only `scripts/tavern/{build.mjs,build.test.mjs,cache.mjs,cache.test.mjs}`, `vendor/tauritavern/{README.ste.md,UPSTREAM.json}` and this source plan. Host-overlay/runtime/UI/package changes remain with the parent.
