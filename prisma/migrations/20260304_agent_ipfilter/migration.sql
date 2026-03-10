-- Migration: Filtrage IP enrollment + agentRevoked
-- 2026-03-04

ALTER TABLE "agent_tokens" ADD COLUMN "ipWhitelist" TEXT;
ALTER TABLE "agent_tokens" ADD COLUMN "ipBlacklist" TEXT;
ALTER TABLE "equipment" ADD COLUMN "agentRevoked" BOOLEAN NOT NULL DEFAULT false;
