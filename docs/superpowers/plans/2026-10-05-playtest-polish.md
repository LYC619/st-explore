# Playtest Polish Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated domains and systematic-debugging/TDD for fixes. User authorizes autonomous execution.

**Goal:** Complete the 10/5 reading, editing, export and chat feedback with a verified Windows build.
**Architecture:** Reuse archive stores and native Tavern runtime; narrow UI fixes, shared pure helpers for UID, export and depth rules, explicit runtime configuration for beautification.
**Tech Stack:** React 18, TypeScript, Vite, Vitest, Playwright, Tauri 2.

## Reading
- [ ] In `src/test/review-markdown.test.tsx`, verify headings/emphasis/list nodes in notes, record previews and overview; run `npx vitest run src/test/review-markdown.test.tsx` red then green.
- [ ] Replace raw/clamped text with MarkdownLite in `NotesSection`, `StoryRecordsView`, `ReviewEdits`, `ReviewCharacterContent`; move review header inside existing scroll root without changing saved offsets or navigation guards.
- [ ] Extend `scripts/smoke/library-review-smoke.mjs` for overflow and reading space and run in isolated browser.

## Regex and bookmarks
- [ ] Add depth boundary and legacy round-trip regression cases; `applyRegexRules(text, rules, isUser, depth)` and preview must share matching logic. Run focused regex tests red/green.
- [ ] Expose recent/exclude/custom depth controls, pass original depth to chat processing and all exports, provide test depth in RegexTool.
- [ ] Add delete bookmark buttons to MessageNavBar/NovelView and fix RegexSidebar available height; test persistence and no accidental jump. Add year to ChatPreview time.

## Worldbook UID
- [ ] Create `src/lib/worldbook-uid.ts`: validate and update UID without mutating source. Test 0, duplicate, fractional/negative/unsafe number and nonnumeric dictionary keys.
- [ ] Integrate explicit UID input/apply action in EntryEditor via WorldBook; preserve selected/batch keys and rebuild exported keys using UID in adapter.
- [ ] Label UID ascending and add descending in use-entry-filters/EntryFilterBar. Verify export round-trip after renaming.

## Direct export and chat entry
- [ ] Add JSON override to character-file and expose in CharacterInfoRail. Test PNG-imported card JSON keeps unknown extensions.
- [ ] Add `src/lib/story-file-export.ts` to serialize main/selected branch in JSON and JSONL with current content and raw metadata/candidates. Test round-trip and immutable source.
- [ ] Replace StoryListSection export redirect with menu; CharacterPage loads current story, flushes reader, exports directly. Add branch export and continue-chat entry through `prepareStoryPlay`.

## Chat
- [ ] In tavern-host use active catalog line when preparing generation, preserve omitted-vs-explicit branch semantics. Test branch A/B/A and persistence with local mock provider.
- [ ] Add visible branch/script controls, surface actual helper running/errors, preserve existing native chat actions.
- [ ] Add `prepareStoryPlay(storyId, requestedBranchId?)` with vault epoch checks and no story duplication.

## Beautification
- [ ] Add a focused `/beautify` route and EditorRail/navigation entry; use current editor story context or selector.
- [ ] Build editable status template, variable JSON sample, inline/floating preview, import existing helper scripts and save to existing runtime helper settings. Templates read message variables and show configured paths; full MVU scripts remain importable with explicit compatibility status.
- [ ] Test generated template escaping and update persistence; browser-check preview/save/open-chat.

## Verification and delivery
- [ ] Run full `npm test`, app/node TypeScript, `npm run lint`, `npm run build`, Tavern source checks, browser smoke.
- [ ] Spec review then code review; resolve substantive findings. Record evidence in docs/verification.
- [ ] Commit scoped changes, fast-forward local main preserving previous status, `npm run tauri:build`, verify fresh files/hash/PE version, write manifest and test instructions.
