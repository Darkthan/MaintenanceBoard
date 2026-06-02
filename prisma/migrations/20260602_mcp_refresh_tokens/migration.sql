-- CreateTable: mcp_refresh_tokens
CREATE TABLE "mcp_refresh_tokens" (
    "id"         TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "mcpTokenId" TEXT,
    "clientId"   TEXT NOT NULL,
    "scopes"     TEXT NOT NULL DEFAULT '[]',
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "ttlDays"    INTEGER,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_refresh_tokens_tokenHash_key" ON "mcp_refresh_tokens"("tokenHash");
CREATE INDEX "mcp_refresh_tokens_userId_idx"     ON "mcp_refresh_tokens"("userId");
CREATE INDEX "mcp_refresh_tokens_mcpTokenId_idx" ON "mcp_refresh_tokens"("mcpTokenId");

-- AddForeignKey
ALTER TABLE "mcp_refresh_tokens"
    ADD CONSTRAINT "mcp_refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_refresh_tokens"
    ADD CONSTRAINT "mcp_refresh_tokens_mcpTokenId_fkey"
    FOREIGN KEY ("mcpTokenId") REFERENCES "mcp_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
