-- Reuse the durable tombstone registry without adding an unknown entity to the
-- v2 SyncChange feed. Existing Push rows and historical migrations are unchanged.
-- No deletion is inferred for rows that disappeared before these triggers exist.
CREATE TRIGGER "sync_Push_no_resurrection" BEFORE INSERT ON "Push"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'coachPushes' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'coach push was deleted; use a new id');
END;

CREATE TRIGGER "sync_Push_identity_immutable" BEFORE UPDATE OF "id", "userId" ON "Push"
WHEN OLD."id" IS NOT NEW."id" OR OLD."userId" IS NOT NEW."userId"
BEGIN
  SELECT RAISE(ABORT, 'coach push identity is immutable');
END;

CREATE TRIGGER "sync_Push_delete" AFTER DELETE ON "Push"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
    VALUES (OLD."userId", 'coachPushes', OLD."id");
END;
