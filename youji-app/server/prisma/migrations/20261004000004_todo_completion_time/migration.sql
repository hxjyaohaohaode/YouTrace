-- Transactional additive upgrade; no historical event or timestamp backfill.
BEGIN IMMEDIATE;
-- Additive and nullable: old completed todos keep unknown occurrence time.
ALTER TABLE "Todo" ADD COLUMN "completedAt" DATETIME;

-- Capture the new field for every writer without altering historical events.
DROP TRIGGER "sync_Todo_insert";
DROP TRIGGER "sync_Todo_update";
CREATE TRIGGER "sync_Todo_insert" AFTER INSERT ON "Todo"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'todos', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'text', NEW."text", 'dueDate', NEW."dueDate", 'priority', NEW."priority", 'done', NEW."done", 'completedAt', NEW."completedAt", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
CREATE TRIGGER "sync_Todo_update" AFTER UPDATE ON "Todo"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'todos', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'text', NEW."text", 'dueDate', NEW."dueDate", 'priority', NEW."priority", 'done', NEW."done", 'completedAt', NEW."completedAt", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;

COMMIT;
