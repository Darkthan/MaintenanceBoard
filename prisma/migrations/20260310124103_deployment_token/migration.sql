-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "purchaseDate" TIMESTAMPTZ,
    "warrantyEnd" TIMESTAMPTZ,
    "qrToken" TEXT NOT NULL,
    "roomId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "discoverySource" TEXT NOT NULL DEFAULT 'MANUAL',
    "discoveryStatus" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "suggestedRoomId" TEXT,
    "lastSeenAt" TIMESTAMPTZ,
    "agentInfo" TEXT,
    "agentHostname" TEXT,
    "agentToken" TEXT,
    "agentRevoked" BOOLEAN NOT NULL DEFAULT false,
    "enrollmentTokenId" TEXT,
    CONSTRAINT "equipment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "equipment_enrollmentTokenId_fkey" FOREIGN KEY ("enrollmentTokenId") REFERENCES "agent_tokens" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_equipment" ("agentHostname", "agentInfo", "agentRevoked", "agentToken", "brand", "createdAt", "description", "discoverySource", "discoveryStatus", "enrollmentTokenId", "id", "lastSeenAt", "model", "name", "purchaseDate", "qrToken", "roomId", "serialNumber", "status", "suggestedRoomId", "type", "updatedAt", "warrantyEnd") SELECT "agentHostname", "agentInfo", "agentRevoked", "agentToken", "brand", "createdAt", "description", "discoverySource", "discoveryStatus", "enrollmentTokenId", "id", "lastSeenAt", "model", "name", "purchaseDate", "qrToken", "roomId", "serialNumber", "status", "suggestedRoomId", "type", "updatedAt", "warrantyEnd" FROM "equipment";
DROP TABLE "equipment";
ALTER TABLE "new_equipment" RENAME TO "equipment";
CREATE UNIQUE INDEX "equipment_serialNumber_key" ON "equipment"("serialNumber");
CREATE UNIQUE INDEX "equipment_qrToken_key" ON "equipment"("qrToken");
CREATE UNIQUE INDEX "equipment_agentToken_key" ON "equipment"("agentToken");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineIndex (sqlite_autoindex already dropped by table redefinition above)
CREATE UNIQUE INDEX IF NOT EXISTS "agent_tokens_token_key" ON "agent_tokens"("token");
