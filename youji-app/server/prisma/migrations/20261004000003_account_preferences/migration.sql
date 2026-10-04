-- Expand only. Old User preference fields remain an atomic compatibility mirror.
BEGIN IMMEDIATE;
CREATE TABLE "AccountPreferences" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "coachStyle" TEXT NOT NULL DEFAULT 'gentle',
  "coachPushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "pushLimit" INTEGER NOT NULL DEFAULT 2,
  "quietEnabled" BOOLEAN NOT NULL DEFAULT true,
  "quietStart" TEXT NOT NULL DEFAULT '23:00',
  "quietEnd" TEXT NOT NULL DEFAULT '07:00',
  "eveningReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
  "eveningReviewTime" TEXT NOT NULL DEFAULT '21:00',
  CONSTRAINT "AccountPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AccountPreferenceReceipt" (
  "userId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "mutationId"),
  CONSTRAINT "AccountPreferenceReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "AccountPreferences" ("userId", "coachStyle", "pushLimit", "quietStart", "quietEnd")
SELECT "id", "coachStyle", "pushLimit", "quietStart", "quietEnd" FROM "User";
COMMIT;
