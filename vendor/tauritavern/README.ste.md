# Pinned TauriTavern frontend in STE

This is the original frontend from [Darkatse/TauriTavern](https://github.com/Darkatse/TauriTavern), commit [`9693a4ec47cd4552f90878bccab453f176de0f18`](https://github.com/Darkatse/TauriTavern/tree/9693a4ec47cd4552f90878bccab453f176de0f18). Its package version is **2.2.0**, and its `src/compat-version.js` identifies the upstream SillyTavern compatibility version as **1.18.0**. The original AGPL license is preserved in `LICENSE`.

The snapshot contains **946 frontend files**, **187 default-content files**, and the four original build/license inputs `LICENSE`, `package.json`, `pnpm-lock.yaml`, and `rspack.config.js`. `UPSTREAM.json` records the repository, commit, source trees, subset and local adaptation policy. `SOURCE-MANIFEST.json` records the SHA-256 and byte length of each of these **1,137 original files**. No original file is edited; `.gitattributes` prevents line-ending conversion from changing its bytes. Original whitespace is retained and excluded from Git whitespace checks for the imported paths; STE-owned tooling and metadata keep normal checks.

`default/content` contains the real upstream startup settings, presets, themes and bundled content. It is available as a read-only input for the STE host integration. The static asset map excludes this entire directory. The native Rust app, its backend, and its service launch scripts are outside this snapshot.

## Root build and development

Run from the STE repository root:

```sh
npm ci
npm run dev
npm run build
```

The Vite plugin in `scripts/tavern/vite-plugin.mjs` prepares the frontend automatically for both development and production. No installation inside this vendor directory is needed. The nested `package.json` is preserved as an upstream build input; its native scripts are not used by STE.

The build uses Node 22.14.0 and the original Rspack 2.0.8 configurations. Required frontend libraries use the direct versions resolved by the original `pnpm-lock.yaml`; STE's root `package-lock.json` pins their installed dependency graph. STE's existing `fflate@0.8.2` is reused. Rspack's `context`, generated output paths and cache storage/version are adapted, and `output.clean` is disabled so the compiler cannot recursively delete cache-directory contents. The original entries, targets, optimization and plugins remain in effect. All three original compiler groups are built so their referenced assets exist; building an Agent/settings bundle does not enable its host functionality.

Useful focused commands:

```sh
npm run tavern:verify
npm run tavern:prepare
npm run test:tavern-source
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.app.json
```

Generated bundles live in `.cache/tavern/bundles`, their hashes and preparation fingerprint in `.cache/tavern/build-manifest.json`, and Rspack's cache in `.cache/tavern/rspack`. Preparation checks the source manifest, root lock, wrapper, Node version, platform and compiler version before reusing output. Every cached bundle is hashed again. Missing or changed generated output is rebuilt; source changes fail verification until deliberately reviewed and recorded.

Cache paths are anchored to the real project directory before a cached manifest is read and before a compiler is created. `scripts/tavern/cache.mjs` checks every cache ancestor, rejects symlinks/junctions and linked cache files, and creates missing directory levels individually with checks before and after creation. Compiler run, emit and close boundaries revalidate declared output/storage ancestry. Full recursive checks run while the compiler is inactive; active checks avoid walking Rspack's native temporary snapshot directories while Windows replaces them. Unlisted cache files remain untouched and are excluded from the emitted asset manifest.

Host generation can use `await prepareCacheDirectory(projectRoot, 'host')` to obtain the validated absolute `.cache/tavern/host` directory. Call it immediately before a host write batch; a previous returned path is not a permanent authorization. The helper also supports `prepareCacheDirectories(projectRoot, relativePaths)` for multiple directories. These checks protect against existing links and detect ancestry replacements at operation boundaries. They do not lock the filesystem against a hostile process with the same user's permissions changing paths between Node and native filesystem calls.

## URL and output ownership

SillyTavern's original `src/index.html` has `<base href="/">`, and its scripts use origin-root URLs. The main application is raw ESM; Rspack builds library/feature bundles and does not replace `src/script.js` with a rebuilt imitation.

| Served URL | Source / generated input | Production artifact |
| --- | --- | --- |
| `/tavern.html` | Original `src/index.html`, with only the two metadata href remaps below | `dist/tavern.html` |
| `/script.js`, `/lib.js`, `/init.js`, `/tauri-main.js` | Original raw modules | `dist/script.js`, `dist/lib.js`, `dist/init.js`, `dist/tauri-main.js` |
| `/css/**`, `/scripts/**`, `/lib/**`, `/locales/**`, `/webfonts/**`, `/img/**`, `/sounds/**`, `/tauri/**` | Original frontend files at matching paths | Matching paths under `dist/` |
| `/dist/lib.core.bundle.js` | Original core library bundle | `dist/dist/lib.core.bundle.js` |
| `/dist/lib.optional.bundle.js` | Original optional library bundle | `dist/dist/lib.optional.bundle.js` |
| `/scripts/extensions/agent-system/dist/index.bundle.js` | Original Agent compiler output | Matching path under `dist/` |
| `/scripts/tauri/setting/dist/{settings,dev-logs,sync}.bundle.js` | Original settings compiler outputs | Matching paths under `dist/` |
| `/tavern-favicon.ico` | Original `src/favicon.ico` | `dist/tavern-favicon.ico` |
| `/tavern.webmanifest` | Original `src/manifest.json`, byte for byte | `dist/tavern.webmanifest` |

The alternate manifest stays at the origin root, so its original relative `img/` icon paths remain valid. The generated entry changes only `href="manifest.json"` to `href="tavern.webmanifest"` and `href="favicon.ico"` to `href="tavern-favicon.ico"`. Original `src/robots.txt` is excluded. STE retains its `/`, `/index.html`, `/favicon.ico`, `/manifest.json`, `/robots.txt`, `/sw.js`, icon files and other existing public assets.

The development middleware serves only manifest entries and verifies their bytes on every read. Unknown requests in upstream static directories and direct vendor/cache/default-content requests fail closed. It rejects encoded traversal, backslashes, malformed paths and real-path escapes. Production uses the same asset map, preflights all destinations, rejects case-insensitive and file/directory collisions, and writes exclusively. A new upstream file that conflicts with STE must receive an explicit reviewed mapping; it cannot silently overwrite STE's output.

## Updating the snapshot

1. Fetch and review a chosen full upstream commit in the ignored `_reference/projects/tauritavern` checkout. Review frontend, host-contract and license changes, plus the original package and lock diff. The current commit's `src` tree is `6afe13fd10ac80a3ee5d3cafb53d75100bf96013`; its `default/content` tree is `290e1b9ff84f88203cb97f7ddd3c14d0245946c2`.
2. Export only the recorded subset with `git archive`, into a fresh staging directory. For the current pin, the export command is:

   ```sh
   git -C _reference/projects/tauritavern archive --format=tar --output=/absolute/staging/tauritavern.tar 9693a4ec47cd4552f90878bccab453f176de0f18 src default/content LICENSE package.json pnpm-lock.yaml rspack.config.js
   tar -xf /absolute/staging/tauritavern.tar -C /absolute/staging/frontend
   ```

   Use a real absolute staging directory appropriate to the machine. Exporting Git objects avoids local checkout changes and line-ending conversions. Compare the staged subset with this vendor directory, then replace only those original paths, including reviewing removed files. Preserve the STE metadata, README and byte-preserving attributes.
3. Update `UPSTREAM.json`, the reviewed pin/version expectations in `scripts/tavern/source.mjs`, and provenance tests. Record the new upstream tree IDs. Match root build dependencies to the new upstream lock and update the root npm lock without unrelated upgrades. Keep any source edits documented separately; current policy requires an untouched upstream snapshot.
4. From STE's root, run `node scripts/tavern/prepare.mjs --record-source`. This maintenance command records the supplied files; it does not fetch or authenticate a new upstream revision. Review its output against the exported Git objects, then run the focused source tests, both TypeScript checks, `npm run build`, and a development smoke check. Confirm protected STE files and all generated output bytes before committing.

Normal development/build commands never regenerate the reviewed source manifest. `.cache/tavern` is disposable build output and is ignored by Git.

## Next host/bootstrap integration

The original initialization order is `init.js -> lib.js -> tauri-main.js -> script.js`. This task delivers that source and its dependencies; it does not yet make native startup, chat persistence, provider calls or Agent behavior work inside STE. No navigation entry advertises working chat.

The single composition seam is `composeAssets()` in `scripts/tavern/build.mjs`, called by `prepareTavern()` before either Vite delivery path consumes its result. Asset records have `{ url, root, path, sha256, size }`; an optional entry transform is confined to the two metadata href remaps. A later STE integration can generate bridge/bootstrap files, add their records, and supply explicit replacement records with the expected original hash:

```js
const assets = composeAssets(pinnedAssets, generatedAssets, [
  { asset: generatedScriptReplacement, expectedSha256: reviewedOriginalScriptHash },
]);
```

Both development and production then deliver the same reviewed overlay. Generate replacements separately and retain original source hashes. Host startup must account for original `init.js` setting `__TAURI_RUNNING__` and its origin-wide development Service Worker registration, preserve STE's Service Worker ownership, provide the STE data/command bridge, and establish stable message IDs on the actual canonical chat array before serialization. Selected `default/content` data can be read during host generation without exposing the whole default-content tree.
