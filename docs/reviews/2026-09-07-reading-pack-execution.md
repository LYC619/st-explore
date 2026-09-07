# Reading Pack Execution Evidence

Date: 2026-09-07. Workspace HEAD: `fc26f091e0d2c7f32b9e6d3235fd4830bb912fd4`.
All repairs are uncommitted working-tree changes. No user vault was read.
This is evidence for P1-P4, not completion of the full F01-F16 goal.

## Status

- [x] P1: Character device-field ownership and fresh character/story reads.
- [x] P2: Mainline/branch progress ownership, clamping and removed-branch handling.
- [x] P3: Bounded streaming ZIP parser and one-shot Worker/client/dialog lifecycle.
- [x] P4: Source/sink audit, new VaultBackend and new IndexedDB connection roundtrips.
- [x] Real browser Worker: Edge synthetic package smoke passed on 2026-09-08.
- [ ] Device peak-memory acceptance.
- [ ] Tauri synthetic-vault and Android acceptance from S2.

## F02

Changes: `restoreCharacter` strips injected device fields and restores only receiver-owned
attachments, assets, unresolvedAssets and sourcePath. Media conversion explicitly selects
the allowed portrait fields. Story restoration strips the corresponding sourcePath,
writebacks, assets and unresolvedAssets. Sender content is not replaced with a stale local
whole-record spread.

`readingPackSource.apply` rereads each character/story before saving, skips deleted
overwrite targets with warnings, and reuses `decide` for receiver updates/concurrent adds.
These reads are not a cross-process compare-and-swap transaction.

Evidence in `src/test/reading-pack.test.ts`:

- `strips injected device fields (overwrite=false/true)`.
- `keeps receiver fields but imports new content`.
- `does not resurrect overwrite targets deleted after inspect`.
- `redecides after a receiver update or concurrent add (existed=true/false)`.
- `propagates a fresh-read failure without writing`.
- `preserves receiver fields after reopening vault/idb`: real source/sink calls,
  a new `createVault(fs)` instance or `closeDB()` followed by a distinct connection,
  local attachment bytes, character fields and story progress reread after import.

RED: initial P1/P2 run had 13 failures out of 34 tests, including device-field injection,
deleted targets and updated/concurrently added targets. Existing successful receiver-field
preservation and reopening tests were retained, not represented as newly failing tests.

## F06

`mergeStoryProgress` uses local values even when the property is absent/undefined.
Both mainline and branches truncate finite floors and clamp to [1, new message count].
Empty content and invalid numeric progress become undefined. Only incoming branches are
kept; the last-viewed branch must still exist.

Evidence in `reading-pack.test.ts`: `reading pack branch progress` covers 100-message
retained branches, 20-message shortened branches, newly added and removed branches,
empty content, negative/fractional/nonfinite floors and omitted local properties.
The original short-story fixture now expects floor 2, not the invalid floors 42/777.

RED: progress cases formed part of the 13 initial failures. GREEN: included in all
combined runs listed below.

## F12

Production extraction uses fflate `Unzip` + `UnzipInflate`, feeding 4096-byte input
chunks. Budgets are compressed input 300 MiB, 4096 entries, 64 MiB per expanded entry,
300 MiB total expanded data and 64 MiB per JSON entry. The internal test budget also
accepts `maxJsonBytes` so tests do not need large allocations. Input files cannot supply
these budgets.

The parser validates EOCD/central directory completeness, local/central header agreement,
paths, duplicate names, compression/encryption, declared sizes and actual callback sizes.
Rejected chunks are not retained or concatenated. CRC32 reuses the existing png-writer
checksum implementation, now exported, to reject corrupt stored/deflated media too.
Errors have stable codes.

The client owns one Worker and transferable buffer per request. File size is checked
before reading; cancellation rejects during file reading and terminates active Workers.
Success, parse failure, Worker error, message decode error, read/constructor/post failures
remove listeners. There is no module-level parsed pack or buffer cache.

The source receives `input.parsed`, not bytes. The dialog invalidates prior request IDs
on cancellation, reselection, closing and unmount, including stale `finally` blocks.
It preserves the exact inspected input for apply, releases plan/input after terminal
paths, and guards sink calls against cancellation or an active-vault change.

Evidence:

- `reading-pack-unzip.test.ts`: 31 cases, including 5000 empty entries, oversized declared
  sizes without allocating their payloads, actual expansion under understated headers,
  tiny total/JSON budgets, streaming data descriptors, corrupt/truncated ZIPs and CRC.
- `reading-pack-worker.test.ts`: 13 cases, fake Worker lifecycle checks plus invoking
  the real Worker message handler with valid and invalid synthetic packages in Node.
- `reading-pack-dialog.test.tsx`: 7 cases using the real React dialog, mocked parsing
  completions and source boundaries; no-save and stale result/finally assertions.

RED: the 30 extraction tests initially failed because the bounded API was missing;
the Worker test suite initially could not load the missing client module. All 7 dialog
tests failed against the old byte-reading implementation. Additional focused RED/GREEN
checks caught corrupted stored data being accepted and synchronous `arrayBuffer()`
failure leaving an abort listener attached; both were repaired.

## Commands And Results

All commands ran in the actual combined working tree, not a clean HEAD checkout.

| Command | Result |
| --- | --- |
| `npx vitest run src/test/reading-pack.test.ts src/test/reading-pack-unzip.test.ts src/test/reading-pack-worker.test.ts src/test/reading-pack-dialog.test.tsx src/test/archive-db.test.ts src/test/png-writer.test.ts --reporter=dot` | Exit 0, 6 files / 99 tests, 21:11 CST |
| `npx tsc -p tsconfig.app.json --noEmit` | Exit 0 |
| `npx eslint . --quiet` | Exit 0 after equivalent control-character check syntax in character-relative-path.ts replaced the lint-invalid regex |
| `npm run build` | Exit 0; emitted `reading-pack.worker-C8PctRdj.js`, 13.75 kB |
| `npx vitest run --reporter=dot` | Exit 0, 158 files / 1378 tests, started 21:16:40 CST, duration 36.92 s |
| `rg -n 'restoreCharacter\(|restoreStory\(|ImportSink|lastParsed|unzipSync' src` | All production calls use the new contracts; unzipSync only remains in reading-pack test repacking fixtures; no lastParsed |

Full tests still print React Router/Vite migration warnings and existing negative-fixture
logs. One existing vault-registry-runtime mock prints a missing getAppConfig warning;
the suite passes, but this is not evidence of a warning-free test run.

The build and Node/jsdom tests do not prove real-browser Worker execution, device heap
usage, native file dialogs, Tauri installation or Android behavior. Those remain S2 work.

## Working-Tree Fingerprints

SHA-256 captured after the above P implementation (before further maintenance work):

| File | SHA-256 |
| --- | --- |
| src/lib/reading-pack/import.ts | D15588CE5D1F7FC9877CBF03ACF143C516310A40E74601C5709C4B7DD53881E8 |
| src/lib/reading-pack/reading-pack-worker-client.ts | 62820921B99913662AC6556616DE019810951745911F63370ECAC393FF372345 |
| src/lib/reading-pack/reading-pack.worker.ts | 8DF3D98AA470823B83094094D9BDF98B2F1AE027CBB32F182D91EADE7D8C964B |
| src/lib/data-source/reading-pack-source.ts | C1C5D414637E1F59AACA706C8832BD1E8CFE6AB763974BC94F6942816EB83BE6 |
| src/components/settings/ReadingPackImportDialog.tsx | 09F36478DC2BD8F8CD7B495575D61B6F5EC803768137F25E6622234B1C713C89 |
