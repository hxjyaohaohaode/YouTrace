-- Additive SQLite sync v2 foundation. Do not rewrite historical migrations.
-- Run atomically under an exclusive maintenance window after backup/restore.
-- Trigger writes and AUTOINCREMENT seq allocation share the business transaction.
-- SQLite has one writer, so committed visibility cannot skip a lower live seq.
BEGIN IMMEDIATE;

CREATE TABLE "SyncChange" (
  "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "userId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL CHECK ("operation" IN ('upsert', 'delete')),
  "payload" TEXT,
  CONSTRAINT "SyncChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SyncChange_userId_seq_idx" ON "SyncChange"("userId", "seq");
CREATE INDEX "SyncChange_userId_entity_entityId_seq_idx" ON "SyncChange"("userId", "entity", "entityId", "seq");
CREATE TABLE "SyncTombstone" (
  "userId" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  PRIMARY KEY ("userId", "entity", "entityId"),
  CONSTRAINT "SyncTombstone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "SyncReceipt" (
  "userId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "mutationId"),
  CONSTRAINT "SyncReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Schedule: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'schedules', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'title', row."title", 'date', row."date", 'startTime', row."startTime", 'endTime', row."endTime", 'type', row."type", 'location', row."location", 'repeat', row."repeat", 'remind', row."remind", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "Schedule" AS row ORDER BY row."id";
CREATE TRIGGER "sync_Schedule_no_resurrection" BEFORE INSERT ON "Schedule"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'schedules' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_Schedule_identity_immutable" BEFORE UPDATE ON "Schedule"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_Schedule_insert" AFTER INSERT ON "Schedule"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'schedules', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'date', NEW."date", 'startTime', NEW."startTime", 'endTime', NEW."endTime", 'type', NEW."type", 'location', NEW."location", 'repeat', NEW."repeat", 'remind', NEW."remind", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Schedule_update" AFTER UPDATE ON "Schedule"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'schedules', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'date', NEW."date", 'startTime', NEW."startTime", 'endTime', NEW."endTime", 'type', NEW."type", 'location', NEW."location", 'repeat', NEW."repeat", 'remind', NEW."remind", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Schedule_delete" BEFORE DELETE ON "Schedule"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'schedules', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'schedules', OLD."id", 'delete', NULL);
END;

-- Expense: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'expenses', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'amount', row."amount", 'category', row."category", 'name', row."name", 'date', row."date", 'source', row."source", 'relatedMood', row."relatedMood", 'isIncome', row."isIncome", 'note', row."note", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "Expense" AS row ORDER BY row."id";
CREATE TRIGGER "sync_Expense_no_resurrection" BEFORE INSERT ON "Expense"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'expenses' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_Expense_identity_immutable" BEFORE UPDATE ON "Expense"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_Expense_insert" AFTER INSERT ON "Expense"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'expenses', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'amount', NEW."amount", 'category', NEW."category", 'name', NEW."name", 'date', NEW."date", 'source', NEW."source", 'relatedMood', NEW."relatedMood", 'isIncome', NEW."isIncome", 'note', NEW."note", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Expense_update" AFTER UPDATE ON "Expense"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'expenses', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'amount', NEW."amount", 'category', NEW."category", 'name', NEW."name", 'date', NEW."date", 'source', NEW."source", 'relatedMood', NEW."relatedMood", 'isIncome', NEW."isIncome", 'note', NEW."note", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Expense_delete" BEFORE DELETE ON "Expense"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'expenses', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'expenses', OLD."id", 'delete', NULL);
END;

-- Todo: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'todos', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'text', row."text", 'dueDate', row."dueDate", 'priority', row."priority", 'done', row."done", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "Todo" AS row ORDER BY row."id";
CREATE TRIGGER "sync_Todo_no_resurrection" BEFORE INSERT ON "Todo"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'todos' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_Todo_identity_immutable" BEFORE UPDATE ON "Todo"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_Todo_insert" AFTER INSERT ON "Todo"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'todos', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'text', NEW."text", 'dueDate', NEW."dueDate", 'priority', NEW."priority", 'done', NEW."done", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Todo_update" AFTER UPDATE ON "Todo"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'todos', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'text', NEW."text", 'dueDate', NEW."dueDate", 'priority', NEW."priority", 'done', NEW."done", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Todo_delete" BEFORE DELETE ON "Todo"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'todos', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'todos', OLD."id", 'delete', NULL);
END;

-- Habit: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'habits', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'name', row."name", 'icon', row."icon", 'frequency', row."frequency", 'sortOrder', row."sortOrder", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "Habit" AS row ORDER BY row."id";
CREATE TRIGGER "sync_Habit_no_resurrection" BEFORE INSERT ON "Habit"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'habits' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_Habit_identity_immutable" BEFORE UPDATE ON "Habit"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_Habit_insert" AFTER INSERT ON "Habit"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'habits', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'name', NEW."name", 'icon', NEW."icon", 'frequency', NEW."frequency", 'sortOrder', NEW."sortOrder", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Habit_update" AFTER UPDATE ON "Habit"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'habits', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'name', NEW."name", 'icon', NEW."icon", 'frequency', NEW."frequency", 'sortOrder', NEW."sortOrder", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Habit_delete" BEFORE DELETE ON "Habit"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'habits', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'habits', OLD."id", 'delete', NULL);
END;

-- QuickNote: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'quickNotes', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'content', row."content", 'timestamp', row."timestamp", 'parsed', row."parsed", 'confirmed', row."confirmed", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "QuickNote" AS row ORDER BY row."id";
CREATE TRIGGER "sync_QuickNote_no_resurrection" BEFORE INSERT ON "QuickNote"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'quickNotes' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_QuickNote_identity_immutable" BEFORE UPDATE ON "QuickNote"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_QuickNote_insert" AFTER INSERT ON "QuickNote"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'quickNotes', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'content', NEW."content", 'timestamp', NEW."timestamp", 'parsed', NEW."parsed", 'confirmed', NEW."confirmed", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_QuickNote_update" AFTER UPDATE ON "QuickNote"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'quickNotes', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'content', NEW."content", 'timestamp', NEW."timestamp", 'parsed', NEW."parsed", 'confirmed', NEW."confirmed", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_QuickNote_delete" BEFORE DELETE ON "QuickNote"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'quickNotes', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'quickNotes', OLD."id", 'delete', NULL);
END;

-- Diary: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT row."userId", 'diaries', row."id", 'upsert', json_object('id', row."id", 'userId', row."userId", 'date', row."date", 'content', row."content", 'mood', row."mood", 'moodScore', row."moodScore", 'source', row."source", 'aiInsight', row."aiInsight", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "Diary" AS row ORDER BY row."id";
CREATE TRIGGER "sync_Diary_no_resurrection" BEFORE INSERT ON "Diary"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = NEW."userId" AND "entity" = 'diaries' AND "entityId" = NEW."id")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_Diary_identity_immutable" BEFORE UPDATE ON "Diary"
WHEN NEW."id" != OLD."id" OR NEW."userId" != OLD."userId"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_Diary_insert" AFTER INSERT ON "Diary"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'diaries', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'date', NEW."date", 'content', NEW."content", 'mood', NEW."mood", 'moodScore', NEW."moodScore", 'source', NEW."source", 'aiInsight', NEW."aiInsight", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Diary_update" AFTER UPDATE ON "Diary"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'diaries', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'date', NEW."date", 'content', NEW."content", 'mood', NEW."mood", 'moodScore', NEW."moodScore", 'source', NEW."source", 'aiInsight', NEW."aiInsight", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Diary_delete" BEFORE DELETE ON "Diary"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES (OLD."userId", 'diaries', OLD."id");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (OLD."userId", 'diaries', OLD."id", 'delete', NULL);
END;

-- HabitCheckin: backfill current rows, capture every writer, preserve deleted IDs.
INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
SELECT (SELECT "userId" FROM "Habit" WHERE "id" = row."habitId"), 'habitCheckins', row."habitId" || '|' || row."date", 'upsert', json_object('id', row."id", 'habitId', row."habitId", 'date', row."date", 'done', row."done", 'source', row."source", 'aiReason', row."aiReason", 'confirmed', row."confirmed", 'createdAt', row."createdAt", 'updatedAt', row."updatedAt")
FROM "HabitCheckin" AS row ORDER BY row."id";
CREATE TRIGGER "sync_HabitCheckin_no_resurrection" BEFORE INSERT ON "HabitCheckin"
WHEN EXISTS (SELECT 1 FROM "SyncTombstone" WHERE "userId" = (SELECT "userId" FROM "Habit" WHERE "id" = NEW."habitId") AND "entity" = 'habitCheckins' AND "entityId" = NEW."habitId" || '|' || NEW."date")
BEGIN
  SELECT RAISE(ABORT, 'SYNC_DELETED_ENTITY');
END;
CREATE TRIGGER "sync_HabitCheckin_identity_immutable" BEFORE UPDATE ON "HabitCheckin"
WHEN NEW."id" != OLD."id" OR NEW."habitId" != OLD."habitId" OR NEW."date" != OLD."date"
BEGIN
  SELECT RAISE(ABORT, 'SYNC_IMMUTABLE_IDENTITY');
END;
CREATE TRIGGER "sync_HabitCheckin_insert" AFTER INSERT ON "HabitCheckin"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES ((SELECT "userId" FROM "Habit" WHERE "id" = NEW."habitId"), 'habitCheckins', NEW."habitId" || '|' || NEW."date", 'upsert', json_object('id', NEW."id", 'habitId', NEW."habitId", 'date', NEW."date", 'done', NEW."done", 'source', NEW."source", 'aiReason', NEW."aiReason", 'confirmed', NEW."confirmed", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_HabitCheckin_update" AFTER UPDATE ON "HabitCheckin"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES ((SELECT "userId" FROM "Habit" WHERE "id" = NEW."habitId"), 'habitCheckins', NEW."habitId" || '|' || NEW."date", 'upsert', json_object('id', NEW."id", 'habitId', NEW."habitId", 'date', NEW."date", 'done', NEW."done", 'source', NEW."source", 'aiReason', NEW."aiReason", 'confirmed', NEW."confirmed", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_HabitCheckin_delete" BEFORE DELETE ON "HabitCheckin"
BEGIN
  INSERT OR IGNORE INTO "SyncTombstone" ("userId", "entity", "entityId")
  VALUES ((SELECT "userId" FROM "Habit" WHERE "id" = OLD."habitId"), 'habitCheckins', OLD."habitId" || '|' || OLD."date");
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES ((SELECT "userId" FROM "Habit" WHERE "id" = OLD."habitId"), 'habitCheckins', OLD."habitId" || '|' || OLD."date", 'delete', NULL);
END;

COMMIT;
