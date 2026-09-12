# STE common helpers and portable play data

The approved scope is the genuine ST interface, a limited set of built-in helper capabilities, and BaiBai as the first extension target. This batch is implemented; the steps below preserve its execution contract. See the [verification record](../../verification/ste-roleplay-runtime-v1.md) for final results and platform limits.

1. Keep original ST chat, variable, macro and event functions authoritative. Import ordinary helper script JSON into a per-branch configuration, disabled until the user enables it and its story-read, story-write or model-request grants.
2. Run imported scripts and opt-in HTML code blocks in opaque-origin `allow-scripts` frames. Supply only granted story snapshots and bounded RPC operations. No parent DOM, native filesystem, connection secrets or ambient network access. Preserve synchronous getters/variable updates in each snapshot, with an explicit asynchronous persistence barrier and visible write failures.
3. Expose the controls in the original extension drawer: script import/enable/grants, variables, interactive HTML, and complete story export/import preview. Preserve ST's own slash command editor and actual rendering lifecycle.
4. Dispose child frames, subscriptions and pending generation on chat change/unmount. Do not rerun scripts per streaming token. Tests must exercise real browser frames, event delivery, persistent variables, write rejection after scope change, and repeated switching.
5. Transfer story branches, referenced assets and readable memory/control files in a complete story package. Preview conflicts before mutation; never silently overwrite same-ID different data. Web restores use a single transaction; desktop stages the complete story directory before publication. Full Web backups also include library preferences, with connection credentials removed.
6. Forks inherit only memory and accepted worldbook versions supported by the forked history. New branches start fresh generation/cache jobs. Verify actual outgoing requests after acceptance and a page reload on a selected branch.
7. Finish source/unit/type/build checks and independent review sequentially, within the user's root-plus-one-worker limit. Record 2,000-message and lifecycle measurements, platform limits and the supported helper surface in the user guide.

Script compatibility is reported by tested functions, not as broad JS-Slash-Runner compatibility. Installed BaiBai source is user-provided and hash pinned; its non-vector behavior remains separate from the built-in script sandbox.
