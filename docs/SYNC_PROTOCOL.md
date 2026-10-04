# Sync v2: committed change feed and durable acknowledgements

Status: **Implemented in the isolated SQLite fixture; production migration and rollout are BLOCKED_EXTERNAL.**

This is the minimal P0 protocol for schedules, expenses, todos, habits, habit checkins, quick notes, diaries and goals. Account settings use a separate versioned CAS/receipt protocol; chat, insights and push messages are not included in this feed. Unsupported top-level push keys are rejected, never silently ACKed.

## Safety properties

- Authentication supplies the owner. Payload `userId` is never trusted. Every feed query and receipt is owner-scoped; existing foreign IDs fail before mutation. Checkins derive ownership from their habit.
- Every insert, update and delete of the eight supported tables, including REST, raw SQL todo toggles and expense batches, writes a `SyncChange` in the same database transaction through SQLite triggers.
- An event stores a full immutable row image, or a deletion with a null image. Consequently a later REST edit does not erase its preceding change image.
- A mutation receipt, all requested business writes and all emitted events commit together. No partial ACK is returned. Failed mutations receive no success receipt.
- Tombstones prevent re-insertion of a deleted owner/entity/ID at the database boundary, not just in the sync route. Normal updates require an exact acknowledged base version.
- No feed, receipt or tombstone garbage collection is implemented. Do not prune them or reuse deleted IDs. A future retention policy requires device expiry and an explicit rebootstrap/conflict protocol first.
- Deleting an account cascades its feed payloads, tombstones and receipts. These private copies are part of the account lifecycle.

## Pull

Request:

```text
GET /api/sync/pull?protocol=2&features=goals-v1&cursor=0&limit=500
```

`cursor` is an unsigned decimal string between 0 and SQLite's signed 64-bit maximum. `limit` is 1–2000, default 500. Timestamps are not cursors. A cursor is not an access token: every query separately filters authenticated ownership. Clients must store it in the corresponding account database.

Response:

```json
{
  "protocol": 2,
  "features": ["goals-v1"],
  "events": [
    {
      "seq": "1042",
      "entity": "todos",
      "entityId": "client-generated-todo-id",
      "operation": "upsert",
      "data": { "id": "client-generated-todo-id", "text": "Draft", "done": false }
    },
    {
      "seq": "1045",
      "entity": "todos",
      "entityId": "deleted-todo-id",
      "operation": "delete",
      "data": null
    }
  ],
  "nextCursor": "1045",
  "hasMore": false
}
```

The example abbreviates the full row image. Nullable fields stay null, booleans are real booleans, timestamps are normalized to ISO strings, and quick-note parsed JSON is decoded. Malformed historical parsed JSON is retained under `legacyRaw` rather than silently replaced by an empty object.

Events are sorted by numeric sequence, not its string representation. `nextCursor` is exactly the final returned event's sequence, or the incoming cursor for an empty page. `hasMore` uses a one-row lookahead. New events may arrive after a response with `hasMore:false`; the next poll begins from the same persisted last event. Gaps caused by other users or rolled-back allocation do not signify missing events.

The client applies a page and its cursor in one local transaction. Pending local drafts must not be overwritten. Preserve conflicting remote event evidence locally, and do not silently change a pending draft's base version to a remote version it never incorporated. Apply account/session checks before accepting a delayed response.

### Why this cursor cannot skip a late-committing earlier event

This proof is specific to a **single SQLite database**, with the shipped triggers installed:

1. SQLite permits only one writer at a time, even in WAL mode.
2. The row write, trigger-generated `INTEGER PRIMARY KEY AUTOINCREMENT` sequence, event and receipt are in that writer's transaction.
3. A second writer cannot allocate/commit its later sequence while the first writer is still uncommitted.
4. Readers see only committed events from their statement snapshot. A reader that returns sequence N therefore cannot later discover a still-uncommitted lower live sequence from another writer.
5. Paging by strictly greater than the last returned sequence is safe without using wall-clock time or a speculative high watermark. Initial rows are backfilled with the same format, so a new client can replay from zero; subsequent writes append normally.

This is **not** a proof for PostgreSQL `BIGSERIAL`, multiple database writers or a distributed event service. A PostgreSQL migration must establish serialized per-owner allocation/commit visibility or another safe committed frontier and repeat the concurrency tests before enabling the protocol.

SQLite requires the autoincrement column to be declared `INTEGER`. Prisma's SQLite driver infers that declared type as a narrow integer even when the Prisma model is `BigInt`; therefore sequence reads use parameterized SQL with `CAST(seq AS TEXT)` and numeric, table-qualified ordering. The >2^53 fixture tests the actual database-to-HTTP path. Do not replace these reads with ORM model reads of `seq` without repeating that test.

## Push and retry

Request uses a durable owner-scoped batch ID and the existing entity arrays:

```json
{
  "protocol": 2,
  "mutationId": "persisted-random-batch-id",
  "todos": [{ "id": "client-generated-todo-id", "text": "Draft", "baseVersion": "0" }],
  "deletions": { "diaryIds": [{ "id": "old-diary-id", "baseVersion": "1040" }] }
}
```

Rules:

- Persist the exact batch payload and mutation ID **before** sending. Retry that payload and ID after timeout, response loss, process restart or retryable failure.
- A new record permits omitted `baseVersion` or `"0"` only if there is no live row and no tombstone. An existing record requires its exact last event sequence.
- Existing-record deletion requires a matching base version. Already-tombstoned deletion is idempotent. Deleting an unknown ID with base 0/omitted durably tombstones the ID and emits a delete event; a late offline create cannot resurrect it.
- Deletion keys are `scheduleIds`, `expenseIds`, `todoIds`, `habitIds`, `quickNoteIds`, `diaryIds`, `habitCheckinIds`, `goalIds`. Values are arrays of `{id,baseVersion}`, not v1 string arrays.
- Checkin logical IDs in events, versions and deletion requests are `habitId|YYYY-MM-DD`. An upsert supplies `habitId` and `date`; the returned row image also retains its server row `id`. Deleting a habit emits child deletion events before the habit deletion event.
- Habits are processed before checkins within a batch. A missing parent is an explicit whole-batch rejection. A foreign parent is an ownership rejection.
- Two diary IDs for one owner/date are a conflict. The server does not overwrite the first diary, silently merge content, remap the second ID or ACK the rejected candidate. The second original remains in the client's durable rejected queue; this is not a separate server-side conflict-draft archive.
- Multiple explicit operations for the same logical entity in one batch are rejected. Coalesce only before freezing a batch, or send them sequentially with the preceding ACK version.
- New content under an already-used mutation ID is rejected. A canonical parsed-payload hash distinguishes legitimate retries. Receipts are scoped by owner, and return the original response even if another mutation has since changed the row.
- The server caps entity array sizes and request body size; the client should use smaller count/byte-bounded batches. It must retain oversized or invalid drafts for correction/export.

Response, returned only after commit:

```json
{
  "protocol": 2,
  "mutationId": "persisted-random-batch-id",
  "acknowledged": true,
  "synced": { "todos": 1, "deletedDiaries": 1 },
  "versions": [
    { "entity": "todos", "entityId": "client-generated-todo-id", "seq": "1042" },
    { "entity": "diaries", "entityId": "old-diary-id", "seq": "1043" }
  ]
}
```

Delete counts mean requested logical deletions confirmed, including already-deleted/absent IDs with a durable tombstone; they do not mean SQL rows newly removed. The client verifies protocol, exact mutation ID and `acknowledged:true`, then atomically removes only the frozen batch's queued records. Newer local records survive. A successor may adopt its own predecessor's ACK version; unrelated remote versions must not be used to bypass conflict review.

A whole-batch ACK is sufficient because the server applies **all** operations or **none**. No client should treat a generic HTTP 200 as an ACK.

## Failures and compatibility

Errors preserve the mutation ID when parsed. A rejected v2 batch returns `acknowledged:false`; it has no committed business effects or success receipt.

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VERSION_CONFLICT` | 409 | Base is stale/missing; conflict includes entity, entityId and serverVersion |
| `ENTITY_DELETED` | 409 | Terminal tombstone; preserve the draft and explicitly recover into a new identity |
| `DIARY_DATE_CONFLICT` | 409 | Another diary ID owns the date; conflict includes conflictingId |
| `MISSING_PARENT` | 409 | Parent habit missing; retain dependent work |
| `OWNERSHIP_CONFLICT` | 403 | Foreign entity/parent; never retry under a different owner |
| `DUPLICATE_ENTITY` | 409 | Repeated logical entity within a frozen batch |
| `MUTATION_ID_REUSED` | 409 | Batch ID reused with different content |
| `INVALID_CHECKIN_ID` | 409 | Deletion natural key invalid |
| `INVALID_SYNC_MUTATION` | 400 | Invalid payload or unsupported top-level key |
| `INVALID_SYNC_CURSOR` | 400 | Invalid/overflow cursor or page limit |
| `SYNC_RETRY_REQUIRED` | 503 | Explicit concurrency/busy failure; retry exact frozen payload/ID |
| `SYNC_MIGRATION_REQUIRED` | 503 | Required trigger missing; pause and investigate migration |
| `SYNC_CLIENT_UPGRADE_REQUIRED` | 426 pull | Goal-unaware v2 client must refresh/upgrade; retain all local mutations |
| `SYNC_UPGRADE_REQUIRED` | 426 pull / 503 push | v1 is disabled; update client and retain its queue |

Legacy push deliberately uses 503 plus `Retry-After:60`: known v1 clients delete queued work after repeated 4xx responses. A 426 push gate would therefore cause the very loss this change prevents. There is no v1 write or timestamp-paging fallback. Rate limits return 429 with `Retry-After`. Invalid authentication follows the shared auth boundary. No non-ACK response authorizes local queue deletion.

## Migration and external release gate

New files only:

- `20261004000000_sync_v2_ledger`: tables, indexes, seven-table baseline events, 35 DB triggers; explicit `BEGIN IMMEDIATE`/`COMMIT` protects both backfill and trigger installation
- `20261004000001_revoked_sessions`: independent session-revocation storage requested by the auth tranche
- `20261004000002_goal_lifecycle`: additive Goal table, ownership/immutable identity checks, five ledger/tombstone triggers; atomic and no automatic local upload
- `20261004000003_account_preferences`: separate complete account preference document and immutable mutation receipts, preserving the existing User fields as an atomic compatibility mirror

No historic migration was edited. The new migration is additive and preserves existing rows. It does not repair the known unsafe populated-data behavior of historical `sync_foundation`, reconstruct pre-cutover deletes, or prove production schema/history. Empty database installation passing is not permission to run the full chain against an unknown populated legacy database.

Before production, all remain **BLOCKED_EXTERNAL** until verified:

1. Identify actual database engine, path, migration history and deployed version without restarting the service. Make a consistent backup and prove restore in isolation.
2. Rehearse the exact observed upgrade path on an isolated copy with a content/count manifest. Resolve historic migration defects without rewriting already-applied checksums. Verify foreign keys, all 40 trigger definitions, backfill counts for the original seven entities plus the new Goal lifecycle, and a real end-to-end page/mutation round trip.
3. Preserve old local/guest/shared libraries and unsent drafts without assuming ownership. Plan cutover for old devices; deleted IDs from before this feed existed cannot be inferred retroactively. Unsafe legacy data must not be blindly bulk-uploaded as new records.
4. Stage a coordinated client/server protocol transition, test two real devices, offline edits, tombstones, diary conflict recovery, quota/crash interruption and account changes. Server fixture tests do not substitute for that rollout exercise.
5. Validate persistent storage, backup/restore and rollback. Rolling the client back to v1 does not permit restoring the unsafe v1 write endpoint. Preserve the new ledger and receipts on rollback.
6. Obtain explicit release approval; no push/deployment is authorized by these local tests.

Use `prisma migrate deploy` for the reviewed path. `prisma db push` does not create these triggers and is not a valid installation or upgrade procedure. A schema rebuild in a future migration can drop triggers; the sync route checks required trigger names on each request and refuses to ACK or page while any are missing. Migration review must also confirm trigger definitions, not merely their names.

## Verification

`node --import tsx --test tests/sync-recovery.test.ts` uses unique temporary synthetic databases, overwrites DATABASE_URL, and deletes only its own fixtures. It covers:

- All seven populated-table backfills; 100/2000/2001/10001 equal-timestamp rows; page-boundary writes; empty-page cursor stability
- Stable receipts, changed-payload rejection, stale versions, cross-owner IDs and whole-batch rollback
- Same-date diary original preservation; explicit orphan rejection; natural checkin keys and child deletion
- All supported REST mutation routes, including raw SQL toggle, expense batch and quick-note confirmation
- Tombstone propagation, repeated/absent delete and direct database resurrection attempts
- A held writer with an independent reader, concurrent mutations/receipts and deterministic randomized event reconstruction
- Account deletion of private synchronization records; sequence precision above 2^53
- Interrupted additive migration rollback with existing data intact; missing-trigger fail-closed behavior

The Node SQLite fixture enables double-quoted string literals **only to match the existing Prisma SQLite compatibility behavior for empty historical migrations**. It does not repair or approve the historical nonexistent checkin `createdAt` source column or populated migration deletions.

Fresh isolated `prisma migrate deploy`, server TypeScript build and focused lint were also run. Production data, PostgreSQL migration, production CI and deployed rollout were not accessed or claimed verified.


## Goal adoption and client compatibility

Goal writes use `/api/sync/push` (`goals` / `deletions.goalIds`), and reads use the same versioned pull feed. There is no second unversioned Goal write API. Manual progress is reversible; task or habit similarity never produces completion. The wire contains only id, title, description, level, domain, priority, progress, targetDate, original createdAt and baseVersion. Unknown legacy fields stay in local recovery copies, not network requests.

The new client requires the `goals-v1` pull feature. An older v2 client receives an explicit 426 rather than encountering an unknown event and repeatedly failing at that page. New client and server must be staged as a pair. Frozen pre-upgrade mutation batches retain their exact payload and ID; no upgrade is permission to clear them. A client rollback that lacks this feature cannot resume sync and must not re-enable unsafe writes.

Local account database version 2 adds `goalRecords` and transactionally copies every original field from the existing `goals` table while recording source snapshots. The original table remains as an isolated source. Merely incrementing the Dexie schema version does **not** stop old JavaScript: Dexie can reopen an older declared schema. The different physical table prevents an old window from changing an active synchronized goal. New/changed/deleted old-source records are detectable and can be explicitly kept as new local copies; a source deletion never silently deletes the current or cloud goal. All recovery decisions bind the compared snapshots and preserve originals in export. Upgrade quota/interruption rolls back the copy and metadata together.

Existing local-only goals do not upload automatically. The user selects and previews their full editable fields and destination account, then explicitly enables sync. Original copies remain under `goal-local-copy:*`. A cloud event colliding with an unadopted local goal is saved as a conflict rather than overwriting it. Choosing a cloud conflict binds the exact displayed event, local record and pending operation IDs; a later change requires a new comparison. Whole-goal edits intentionally conflict instead of guessing field-level merges.

Local backup format version 2 keeps active rows under `tables.goals`, original account-table sources under `tables.legacyGoalSources`, and includes `storageVersion` plus all recovery snapshots in settings. This does not claim ownership of the separate old shared `youtrace` database.
