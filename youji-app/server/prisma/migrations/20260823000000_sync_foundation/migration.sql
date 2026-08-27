-- Sync foundation: uniform updatedAt cursors, string primary keys for
-- client-generated entities, uniqueness for upsert targets, business indexes.
ALTER TABLE "Expense" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Expense" ADD COLUMN "isIncome" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Expense" ADD COLUMN "note" TEXT;
ALTER TABLE "QuickNote" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Habit" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

DELETE FROM "HabitCheckin" WHERE "id" NOT IN (
    SELECT MAX("id") FROM "HabitCheckin" GROUP BY "habitId", "date"
);
CREATE TABLE "new_HabitCheckin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "aiReason" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HabitCheckin_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_HabitCheckin" ("id", "habitId", "date", "done", "source", "aiReason", "confirmed", "createdAt")
SELECT lower(hex(randomblob(16))), "habitId", "date", "done", "source", "aiReason", "confirmed", "createdAt"
FROM "HabitCheckin";
DROP TABLE "HabitCheckin";
ALTER TABLE "new_HabitCheckin" RENAME TO "HabitCheckin";
CREATE UNIQUE INDEX "HabitCheckin_habitId_date_key" ON "HabitCheckin"("habitId", "date");

DELETE FROM "Diary" WHERE COALESCE("updatedAt", "createdAt") < (
    SELECT MAX(COALESCE(d2."updatedAt", d2."createdAt")) FROM "Diary" AS d2
    WHERE d2."userId" = "Diary"."userId" AND d2."date" = "Diary"."date"
);
DELETE FROM "Diary" WHERE "rowid" NOT IN (
    SELECT MIN("rowid") FROM "Diary" GROUP BY "userId", "date"
);
CREATE TABLE "new_Diary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mood" TEXT,
    "moodScore" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "aiInsight" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Diary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Diary" ("id", "userId", "date", "content", "mood", "moodScore", "source", "aiInsight", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "userId", "date", "content", "mood", "moodScore", "source", "aiInsight", "createdAt", "updatedAt"
FROM "Diary";
DROP TABLE "Diary";
ALTER TABLE "new_Diary" RENAME TO "Diary";
CREATE UNIQUE INDEX "Diary_userId_date_key" ON "Diary"("userId", "date");

CREATE INDEX "Schedule_userId_date_idx" ON "Schedule"("userId", "date");
CREATE INDEX "Expense_userId_date_idx" ON "Expense"("userId", "date");
CREATE INDEX "Todo_userId_done_idx" ON "Todo"("userId", "done");
CREATE INDEX "Habit_userId_idx" ON "Habit"("userId");
CREATE INDEX "QuickNote_userId_timestamp_idx" ON "QuickNote"("userId", "timestamp");
CREATE INDEX "ChatSession_userId_createdAt_idx" ON "ChatSession"("userId", "createdAt");
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");
CREATE INDEX "Insight_userId_createdAt_idx" ON "Insight"("userId", "createdAt");
CREATE INDEX "Push_userId_read_createdAt_idx" ON "Push"("userId", "read", "createdAt");
