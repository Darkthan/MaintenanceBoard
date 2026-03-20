-- Ajout des colonnes agentRevoked et enrollmentTokenId sur equipment
-- (version PostgreSQL — remplace le pattern SQLite DROP/RENAME table)
ALTER TABLE "equipment" ADD COLUMN "agentRevoked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "equipment" ADD COLUMN "enrollmentTokenId" TEXT;

ALTER TABLE "equipment"
  ADD CONSTRAINT "equipment_enrollmentTokenId_fkey"
  FOREIGN KEY ("enrollmentTokenId") REFERENCES "agent_tokens" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index unique sur agent_tokens.token (si pas encore créé)
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tokens_token_key" ON "agent_tokens"("token");
