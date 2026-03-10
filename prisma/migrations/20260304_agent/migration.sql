-- Migration : Système d'agents - AgentToken + champs Equipment
-- Compatible SQLite

-- Nouveau modèle AgentToken
CREATE TABLE "agent_tokens" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "token"       TEXT NOT NULL UNIQUE,
  "label"       TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"  DATETIME,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "agent_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Champs agent sur Equipment
ALTER TABLE "equipment" ADD COLUMN "discoverySource"  TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "equipment" ADD COLUMN "discoveryStatus"  TEXT NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "equipment" ADD COLUMN "suggestedRoomId"  TEXT;
ALTER TABLE "equipment" ADD COLUMN "lastSeenAt"       DATETIME;
ALTER TABLE "equipment" ADD COLUMN "agentInfo"        TEXT;
ALTER TABLE "equipment" ADD COLUMN "agentHostname"    TEXT;
ALTER TABLE "equipment" ADD COLUMN "agentToken"       TEXT;

-- Index unique sur agentToken (SQLite ne supporte pas UNIQUE sur ALTER TABLE ADD COLUMN)
CREATE UNIQUE INDEX "equipment_agentToken_key" ON "equipment"("agentToken") WHERE "agentToken" IS NOT NULL;
