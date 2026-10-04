-- Session IDs are irreversible hashes, never raw bearer tokens.
CREATE TABLE "RevokedSession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
