CREATE TABLE IF NOT EXISTS "ip_network_revisions" (
  "id" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorName" TEXT,
  "snapshot" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_network_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_network_revisions_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ip_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ip_network_revisions_networkId_createdAt_idx" ON "ip_network_revisions"("networkId", "createdAt");
ALTER TABLE "ip_networks" ADD COLUMN IF NOT EXISTS "secondaryGateways" TEXT;
