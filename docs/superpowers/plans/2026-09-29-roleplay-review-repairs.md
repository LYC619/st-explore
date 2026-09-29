# Roleplay review repairs implementation plan

> Execute the authorized fixes in the existing `codex/ste-roleplay-runtime` worktree, using test-first debugging and independent review before merging.

**Goal:** Resolve confirmed chat/Agent recovery defects from the September 18 review and merge the verified result into local main without losing existing workspace changes.

**Architecture:** Keep the single story save queue, persisted memory journals and original upstream frontend. Add bounded, cancellable tool operations; re-plan only invalidated memory proposals while retaining transaction recovery and manual-file protection; preserve narrator visibility during live-chat conversion. Do not silently overwrite conflicts or change upstream vendor files.

**Tech stack:** TypeScript, Vitest, React/Tauri 2, pinned SillyTavern frontend, Playwright and Rust tests.

## Execution

- [x] H1: In `src/test/roleplay-agent-runtime.test.ts`, reproduce cancelling a send while background maintenance is pending. In `src/test/roleplay-tool-agent.test.ts`, cover stalled requests and stalled response bodies with fake timers. Run these tests red, then implement abort-aware waits and a total tool-loop deadline in the roleplay layer. Release timers/listeners and reject late results.
- [x] H2: Reproduce a stored proposal whose target was manually changed before commit; retry must read current resources, preserve the manual note and commit a fresh delta. Add a typed stale-proposal failure in `memory.ts` and a persisted replan state/attempt identity in `agent-runtime.ts`. Preserve replay for ordinary transient failures and committed transactions; leave unresolved multi-file conflicts protected until manually resolved.
- [x] H3: Reproduce visible `/sys` narrator save/reopen in `roleplay-live-chat.test.ts`, alongside hidden messages, native system messages and swipe metadata. Fix the live codec without changing vendor sources, run focused tests and independently review the result.
- [x] Triage remaining September 18 findings against code; repair confirmed merge blockers, record compatibility/performance limitations separately rather than applying unsafe suggested fixes.
- [x] Run affected tests, TypeScript, lint, source-integrity checks, full unit suite, browser roleplay suite, production build and Rust tests. Inspect every result, record platform and real-model limits.
- [x] Obtain independent spec/correctness review, resolve important findings, commit exact reviewed files (including the previously corrected navigation assertion and original review report).
- [x] Check main's local edits and remote state, preserve overlapping local changes with a recoverable backup, merge locally, verify merged commit/code and restore/check all preserved edits. Keep the existing development checkout and ignored trial artifacts available.

## Initial evidence

HEAD is `d737396`; main is `25c2dda`. The only pre-existing development changes are `src/test/ux-maintenance-models.test.ts` and `docs/reviews/2026-09-18-roleplay-agent-review.md`. Focused existing tests pass, but the live codec reproducer changes narrator `is_system` from false to true. Root checkout contains unrelated reference-file deletions, a modified `.gitignore` and untracked documents/assets; these are not part of the implementation commit.

## Progress and verification

- 2026-09-29: User authorized repairs after review; root causes checked in runtime, codec, memory transaction and tool transport paths.

- 2026-09-29: Fixes committed as baa7c40 and fast-forwarded into main; local changes preserved, dependency install and 73 merged-directory tests passed. A CRLF-only version-check false positive found after merge was covered by a red/green script test and fixed with independent review. See docs/verification/ste-roleplay-review-repairs-2026-09-29.md for full results.
