ALTER TABLE "mcp_tokens" DROP CONSTRAINT IF EXISTS "mcp_tokens_createdById_fkey";

ALTER TABLE "mcp_tokens"
  ADD CONSTRAINT "mcp_tokens_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
