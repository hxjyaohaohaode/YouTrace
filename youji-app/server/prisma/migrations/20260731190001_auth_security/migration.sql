-- This migration directory is retained for compatibility with databases that
-- were created during the authentication hardening work. The auth tables and
-- indexes are part of the initial baseline migration, so there is no second
-- schema change to apply here. Keeping an explicit, tracked SQL file prevents
-- Prisma's migration engine from treating the directory as corrupt.
CREATE TABLE IF NOT EXISTS "__youji_auth_security_marker" ("id" INTEGER NOT NULL PRIMARY KEY);
DROP TABLE "__youji_auth_security_marker";
