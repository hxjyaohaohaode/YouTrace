-- Additive Goal lifecycle. Existing local-only goals are NOT claimed or uploaded.
-- Use a backed-up isolated copy to verify before any authorized production migration.
BEGIN IMMEDIATE;
CREATE TABLE "Goal" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "level" TEXT NOT NULL DEFAULT 'short' CHECK ("level" IN ('short', 'medium', 'long')),
  "domain" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium' CHECK ("priority" IN ('low', 'medium', 'high')),
  "progress" INTEGER NOT NULL DEFAULT 0 CHECK ("progress" BETWEEN 0 AND 100),
  "targetDate" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Goal_userId_level_idx" ON "Goal"("userId", "level");
CREATE TRIGGER "sync_Goal_no_resurrection" BEFORE INSERT ON "Goal"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'goals' AND "entityId" = NEW."id")
BEGIN SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY'); END;
CREATE TRIGGER "sync_Goal_identity_immutable" BEFORE UPDATE ON "Goal"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId" OR NEW."createdAt" != OLD."createdAt"
BEGIN SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY'); END;
CREATE TRIGGER "sync_Goal_insert" AFTER INSERT ON "Goal"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'goals', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'description', NEW."description", 'level', NEW."level", 'domain', NEW."domain", 'priority', NEW."priority", 'progress', NEW."progress", 'targetDate', NEW."targetDate", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Goal_update" AFTER UPDATE ON "Goal"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'goals', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'description', NEW."description", 'level', NEW."level", 'domain', NEW."domain", 'priority', NEW."priority", 'progress', NEW."progress", 'targetDate', NEW."targetDate", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Goal_delete" BEFORE DELETE ON "Goal"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId") VALUES (OLD."userId", 'goals', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload") VALUES (OLD."userId", 'goals', OLD."id", 'delete', NULL);
END;
COMMIT;
