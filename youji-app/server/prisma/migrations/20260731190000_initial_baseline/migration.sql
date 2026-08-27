CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "avatar" TEXT NOT NULL DEFAULT '',
    "identity" TEXT NOT NULL DEFAULT 'student',
    "city" TEXT NOT NULL DEFAULT '',
    "coachStyle" TEXT NOT NULL DEFAULT 'gentle',
    "quietStart" TEXT NOT NULL DEFAULT '23:00',
    "quietEnd" TEXT NOT NULL DEFAULT '07:00',
    "pushLimit" INTEGER NOT NULL DEFAULT 3,
    "ignoredCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "title" TEXT NOT NULL,
    "date" TEXT NOT NULL, "startTime" TEXT NOT NULL, "endTime" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'other', "location" TEXT NOT NULL DEFAULT '',
    "repeat" TEXT NOT NULL DEFAULT 'none', "remind" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL, "name" TEXT NOT NULL, "date" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual', "relatedMood" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Todo" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "text" TEXT NOT NULL,
    "dueDate" TEXT, "priority" TEXT NOT NULL DEFAULT 'medium', "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Todo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Habit" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL, "frequency" TEXT NOT NULL DEFAULT 'daily',
    "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Habit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "HabitCheckin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "habitId" TEXT NOT NULL,
    "date" TEXT NOT NULL, "done" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual', "aiReason" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "HabitCheckin_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "QuickNote" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "content" TEXT NOT NULL,
    "timestamp" BIGINT NOT NULL, "parsed" TEXT NOT NULL, "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuickNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Diary" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL, "content" TEXT NOT NULL, "mood" TEXT, "moodScore" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual', "aiInsight" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Diary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'user_initiated', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY, "sessionId" TEXT NOT NULL, "role" TEXT NOT NULL,
    "content" TEXT NOT NULL, "actions" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Insight" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT NOT NULL, "dataSources" TEXT NOT NULL,
    "actionSuggested" TEXT, "actionTaken" BOOLEAN NOT NULL DEFAULT false, "actionResult" TEXT,
    "dismissed" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Insight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Push" (
    "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "insightId" TEXT,
    "type" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "actions" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false, "acted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Push_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY, "phone" TEXT NOT NULL, "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5, "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "RegistrationTicket" (
    "id" TEXT NOT NULL PRIMARY KEY, "phone" TEXT NOT NULL, "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL, "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE INDEX "AuthChallenge_phone_purpose_createdAt_idx" ON "AuthChallenge"("phone", "purpose", "createdAt");
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");
CREATE UNIQUE INDEX "RegistrationTicket_tokenHash_key" ON "RegistrationTicket"("tokenHash");
CREATE INDEX "RegistrationTicket_phone_expiresAt_idx" ON "RegistrationTicket"("phone", "expiresAt");
CREATE INDEX "RegistrationTicket_expiresAt_idx" ON "RegistrationTicket"("expiresAt");
