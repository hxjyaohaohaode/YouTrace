-- Additive: recurrence exceptions use the same canonical Schedule revision.
BEGIN IMMEDIATE;
ALTER TABLE "Schedule" ADD COLUMN "exceptions" TEXT NOT NULL DEFAULT '[]';
DROP TRIGGER "sync_Schedule_insert";
CREATE TRIGGER "sync_Schedule_insert" AFTER INSERT ON "Schedule"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'schedules', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'date', NEW."date", 'startTime', NEW."startTime", 'endTime', NEW."endTime", 'type', NEW."type", 'location', NEW."location", 'repeat', NEW."repeat", 'remind', NEW."remind", 'exceptions', NEW."exceptions", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
DROP TRIGGER "sync_Schedule_update";
CREATE TRIGGER "sync_Schedule_update" AFTER UPDATE ON "Schedule"
BEGIN
  INSERT INTO "SyncChange" ("userId", "entity", "entityId", "operation", "payload")
  VALUES (NEW."userId", 'schedules', NEW."id", 'upsert', json_object('id', NEW."id", 'userId', NEW."userId", 'title', NEW."title", 'date', NEW."date", 'startTime', NEW."startTime", 'endTime', NEW."endTime", 'type', NEW."type", 'location', NEW."location", 'repeat', NEW."repeat", 'remind', NEW."remind", 'exceptions', NEW."exceptions", 'createdAt', NEW."createdAt", 'updatedAt', NEW."updatedAt"));
END;
COMMIT;
