# Library maintenance implementation plan

> **Execution:** Existing delegated work was integrated; final implementation and review were completed by the primary agent, following the user's request to limit agent concurrency. Preserve the existing dirty working tree. No blanket staging or commits of pre-existing work.

**Goal:** Implement the approved 2026-10-11 maintenance specification, including file retention/cleanup, record moves, story copies and type-scoped tag counts.

**Architecture:** File lifecycle operations use captured vault/repository handles, explicit managed-file manifests and durable retention operations. Story operations use captured repositories and existing story queues/transaction helpers. UI uses the existing dialogs and settings. Facet display counts are separate from global tag definitions.

**Tech Stack:** React, TypeScript, IndexedDB, Tauri VaultFs, Vitest, Playwright.

## Baseline

- [x] Read the approved spec and inspect storage, summary, story and filtering code.
- [x] Baseline: 48 tests pass in library-query, library-tag-preferences, vault-backend and organize.
- [x] Preserve a source snapshot for distinguishing this work from pre-existing edits.

## A. File lifecycle and settings

Owned files: `src/lib/vault/file-maintenance.ts`, `src/lib/vault/vault-backend.ts`, `src/lib/repo/idb-repo.ts`, `src/lib/repo/index.ts`, `src/components/settings/FileMaintenancePanel.tsx`, associated tests. Root integrates settings entry and domain deletion wrappers.

- [x] Add failing behavioral tests for retained files surviving restart without reindex, explicit removal, unrecognized-file preservation, failed moves/recovery, reference checks, corrupt/incomplete scans, and scope changes.
- [x] Extend `Repo.remove(id, options?: RemoveOptions)` with `RemoveOptions = { deleteFiles: boolean }`. Omitted options retain legacy cleanup behavior for internal pruning/rollback; explicit false retains source files, explicit true trashes managed files.
- [x] Implement operation manifests, file enumeration and retention, recoverable failure handling, backend cache/index invalidation, strict path checks and conservative scan/cleanup.
- [x] Build settings panel with scan state, categorized files, sizes, selection, cleanup confirmation, errors and stale-scope protection.
- [x] Run `npx vitest run src/test/file-maintenance.test.ts src/test/vault-backend.test.ts --reporter=dot`; inspect failures and repair.

## B. Story operations

Owned files: new `src/lib/story-maintenance.ts`, `src/components/organize/MoveRecordDialog.tsx`, `src/types/summary.ts`, record UI and story-copy buttons in `StoryListSection.tsx`. Coordinate small insertions in CharacterPage/Index with root.

- [x] Add tests moving records between stories (source provenance, branch validation, failed persistence), and copying complete stories (ID remap, no ST writeback target, manual records, independent contents, rollback, runtime files).
- [x] Implement `moveSummaryToStory(recordId, targetStoryId, targetBranchId?)` and `duplicateArchiveStory(storyId)` using captured stores, checked scope, queues and transaction/staged publication helpers.
- [x] Wire searchable target selection and record move actions. Disable incorrect floor jumping/regeneration until destination range explicitly set; preserve original source provenance.
- [x] Add copy action to bound and unbound story lists; guard active generation, reload and report errors.
- [x] Run focused story-maintenance and record UI tests.

## C. Tag counts

Owned files: `src/lib/library-query.ts`, `src/lib/library-tag-preferences.ts`, focused tests. Coordinate Library.tsx integration with root.

- [x] Add 18-story-card fixture with 6 fine-rating cards and unrelated cards, search, zero, duplicate/legacy rating, custom tags and unclassified cases.
- [x] Implement scoped display counts while preserving full global tag definitions, global tag-manager counts and selected zero-count visibility.
- [x] Run `npx vitest run src/test/library-query.test.ts src/test/library-tag-preferences.test.ts src/test/library-filter-rail.test.tsx --reporter=dot`.

## D. Delete UI and domain integration (root)

Owned files: `DeleteConfirmDialog.tsx`, domain deletion wrappers, CharacterPage/Index/Library deletion handlers, asset pages, record deletion handlers (coordinate with B), portrait deletion and GlobalSettings entry.

- [x] Add failing tests for unchecked default, async pending/error behavior, IDB checkbox absence and delete-option propagation.
- [x] Use explicit delete options on user actions only; preserve internal auto-pruning behavior.
- [x] Centralize character-story detachment and story-record detachment; capture scope, preserve records and reject active writes.
- [x] Wire preview of deletion scope/size and retain/erase choice in every supported user deletion entry.
- [x] Run focused deletion and page regressions.

## E. Review and verification

- [x] Review specification coverage first, then correctness/data integrity with separate reviewer passes; fix actionable findings.
- [x] Run affected Vitest tests and then full tests if feasible, application/Node TypeScript, focused ESLint, production build.
- [x] Browser-check dialogs, story moving/copying, filters and settings; validate file backend with in-memory filesystem fault/restart tests. Do not claim native desktop/device verification without running it.
- [x] Update this plan and write `docs/verification/2026-10-11-library-maintenance.md` with exact checks and limitations.
