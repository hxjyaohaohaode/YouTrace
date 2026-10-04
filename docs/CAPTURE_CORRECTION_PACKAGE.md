# First usable recording loop: implementation and acceptance boundary

Date: 2026-10-04. Status: **Implemented candidate; new real-browser and independent product acceptance pending**. This is one bounded package, not completion of YouTrace, launch approval or software-copyright certification.

## Why this package

The full repository audit and independent fresh Chromium baseline at `2c5e7ba365e2b06e1eeb9102cbcf4ab9c6c08b17` found a real blank route surface, stripped relative deadlines, no whole-category correction when rules missed a category, forced/defaulted emotion, a silent 60-record history cutoff and links that reached lists instead of the clicked object. Historical diary manual correction was working and remains a regression requirement.

The original direction is preserved: simple first use, optional depth, original text → revisable candidates → user-selected write → a findable result. Exact 有迹 / YouTrace branding, assets, Login and Splash source stay unchanged. The separate unpublished shared-legacy recovery worktree is not part of this package.

## What changes

- Stable route surface no longer nests fixed capture inside an exiting transparent/zero-height animation parent. Individual features retain their own transitions and user reduced-motion policy. Identity text is never scrambled into a different name.
- New-account Home offers a single clear first-record task. Other capabilities remain available. No invented ¥2,500 fact: budget is unset, explicitly configured (including zero), or an unknown historical value retained for review.
- Capture saves exact original text, including whitespace, and its reference day/timezone. Relative dates use the captured day, not the eventual Save day. Unknown old dates remain unknown and need confirmation. Rules are explicitly rules, not a model or diagnosis.
- Confirmation can add whole categories, remove/re-add the last item, edit absolute dates/CNY amount/direction/category, choose no deadline, exclude diary, and decline emotion. Specific times remain in task text; there is no invented time-of-day reminder. Unsupported/ambiguous money expressions remain original text for manual correction.
- Only selected structured fields are written. Raw original text is separately and visibly included in the account-synced quick note; excluding inferred mood does not redact a user's raw sentence. No model request or third-party telemetry is added.
- A single transaction writes records, pending mutations, source preservation and a receipt with actual entity IDs. Exact retry does not duplicate work. Different concurrent confirmation revisions fork rather than overwrite. Local durability and cloud acknowledgment are separately displayed.
- Todo, Expense and Diary accept exact record links, expose correction fields, retain cancel/error drafts, compare complete stale snapshots and atomically consume the exact saved draft. Deleted records can only become new-ID copies. Same-date diary conflicts show originals rather than silently replace them.
- Failed draft writes also have document-lifetime, account/session/clear-epoch-scoped memory protection when native browser Back unmounts an editor. This is not disk durability: a full reload/close warns, and user-confirmed exit can lose an unpersisted memory-only draft. Cancel buttons wait for durable retention; error/copy/retry remain visible.
- Timeline uses actual completion timestamps when known, record dates otherwise, and explicitly unknown legacy completion times. Deadlines and invented noon are not occurrence times. Continuation reaches records beyond 60. Precise links and source return paths connect actual objects.

## Compatibility and privacy

`20261004000004_todo_completion_time` is additive and transactional. It adds nullable `Todo.completedAt` and rebuilds insert/update changefeed triggers with the field. Existing completed rows and historical events are not backfilled or rewritten. New actual completion, replay, cache rebuild and undo are verified with isolated real Hono/SQLite and fake IndexedDB tests. Production database/backup/restore/restart behavior is still untested and requires its own authorized release procedure.

A persisted old confirmation is explicitly opened under the verified account and current clear epoch. Its original unbound source is preserved locally. Existing open callers do not gain new authority after clear, sign-out or session changes. Actor checks also run after the final receipt/source writes, not just before mutation.

Normal Todo/Expense mutations project known scalar fields onto the wire, retaining unknown local recovery fields. Capture candidates validate primitive IDs and fields before writing. An old frozen request with unreviewed fields is **not rewritten under its old mutation ID** and is not sent: the exact request, queue and ID remain local; Settings explains the stop and offers existing backup export. Automatic disposition/upload of those historical unsafe batches is not implemented. Known safe historical timestamps remain compatible and byte-identical on retry.

## Evidence, honestly separated

- Prior real-browser baseline: [run 37225201475](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37225201475), expected product failures retained.
- Current local frontend: lint, typecheck, production build and 195 tests passed, including the transactional migration in isolated roundtrip fixtures. Backend lint/build and 46 tests also passed, including interrupted additive migration rollback. Tests that use `fake-indexeddb` are API-substitute tests, not browser IndexedDB evidence.
- Independent core review: 11 adversarial cases, 3 real Hono/SQLite roundtrips and a 71-case repository combination passed. Findings closed include malformed amount tokens, trigger payload omission, late session changes, old review epoch revival, unknown/frozen field transmission, inaccurate habit receipt effect and original-whitespace loss.
- New scripted browser outcome checks operate Home → capture → actual corrections/selections → receipt → exact edits → return; historical same-name records, narrow screen and actual IndexedDB fault injection are distinct scenarios. They do not set UI field values or click controls via DOM evaluation. Fixture API writes and fault injection are explicitly identified. Native date-control input failures remain tool blockages, not product conclusions.
- Every successful/failed task retains viewport PNG, contemporaneous DOM/geometry, trace, video and actual state results. All are synthetic. Evidence is split into ≤24 MiB byte parts with order and SHA-256 manifest for reliable retrieval, never trimmed to hide failures.
- New browser results and independent product/UX review remain pending at this document version. A passing script alone is not full product acceptance. All other Y3–Y9/full-page component response coverage remains open.

## Remaining stages

1. Functional outcomes: this recording/correction loop is the current candidate; coach/action/goal/routine full tasks and legacy recovery integration remain separate bounded work.
2. Full page/component UX: fresh first-package review pending; subsequent independent tasks and normal/error/keyboard/narrow/reduced-motion coverage still required.
3. Real services/accounts/data: synthetic services verified where stated; real SMS, model quality/cost, real account migration and production data are not validated.
4. Safety/concurrency: local and isolated server regressions plus independent adversarial review are ongoing; no claim of security certification.
5. Release/backup/restore/observability/rollback: no production deployment. Dashboard state, real backup/restore rehearsal and approved release gates remain required.
6. Source/manual/screenshots/licenses/ownership: the audit and evidence improve traceability; complete manual, consistent final screenshots, dependency-license/asset provenance and applicant ownership confirmation remain open. No legal filing or ownership assumption is made.

### First fresh implementation UI round: `0708ec8`

[Run 37231832046](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37231832046) is **red, retained**. The scripted desktop and 360px tasks did reach real visible capture, reviewed absolute dates/CNY, selected-only writes, durable receipts, isolated server ACK, exact current-expense correction, category re-addition and text-mode quota recovery. The former blank route is not present in those actual flows.

It also exposed a genuine compatibility defect: nullable fields from a historical server Expense were rejected by the new wire projector. The visible editor retained the source and showed failure; the correction was not saved. The follow-up allows only the two schema-defined nullable fields and adds a real API/fake IndexedDB regression and independent malformed-leaf/frozen-request tests. Source money totals and an old insight snapshot also appeared contradictory; the follow-up labels/time-stamps historical advice and makes depth optional while current totals and records stay primary. Previous-page success notifications must not cover or imply success for a new unsaved draft.

Other red observations are kept separate: native date keystrokes accidentally appended to the year; a history count was read before React completed expansion (the contemporaneous saved DOM contains 78/78); an open failed-expense dialog prevented the next diary scenario; the old regression used a removed checkbox sibling selector. Test repairs retain actual native controls and business assertions. New fixes have 197 local frontend tests and 46 backend tests passing, but require another exact-SHA browser run and independent visual review. This is not a software-launch sign-off.

### Covered task job green: `892ecbfe`; full run still red

The new scripted task job in [run 37233016698](https://github.com/hxjyaohaohaode/YouTrace/actions/runs/37233016698) passed its desktop/360px capture, selection, exact correction, canceled-draft recovery, near-seven-day high-volume history return and quota-recovery assertions. Source start/end were clean with matching content hashes; all 180 original evidence files were verified after retrieval. This does **not** cover older-than-30-day discovery, fresh cross-midnight/two-tab/A-B-A tasks or all routes. The old browser suite remained red on its obsolete amount accessibility selector; the actual visible expense and income values were correct. The follow-up also makes direction explicit to screen readers instead of merely dropping that assertion.

Independent visual review still found usability issues that a green task assertion missed: the creation receipt displayed old labels/dates after an actual correction, and 360px expanded totals were visually ellipsized. The follow-up keeps the creation receipt immutable, reads current records and their outbox/version/conflict atomically, labels historical evidence explicitly, clears stale current/ACK state on read failure and offers retry. Aggregate amounts now adapt to their available container width without ellipsis or repeated decorative period charts. Obsolete success/info notices clear on the next control action; warning/error notices are not cleared by that action, but the existing 3.8-second timeout is unchanged. These changes require new browser evidence; their local/pure-state tests alone are not UI acceptance.
