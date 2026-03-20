-- Migration: table login_logs pour tracer les connexions utilisateurs
CREATE TABLE "login_logs" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "method"    TEXT NOT NULL DEFAULT 'PASSWORD',
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "login_logs_userId_idx" ON "login_logs"("userId");
CREATE INDEX "login_logs_createdAt_idx" ON "login_logs"("createdAt");
