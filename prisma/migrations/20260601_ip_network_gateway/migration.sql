-- Catch up the IP addressing tables added before migrations were versioned.
CREATE TABLE IF NOT EXISTS "ip_networks" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "vlan" INTEGER,
  "cidr" TEXT NOT NULL,
  "gateway" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_networks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ip_range_definitions" (
  "id" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "startHost" INTEGER NOT NULL,
  "endHost" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "rangeType" TEXT NOT NULL DEFAULT 'STATIC',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_range_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_range_definitions_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ip_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ip_addresses" (
  "id" TEXT NOT NULL,
  "networkId" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "hostname" TEXT,
  "equipmentType" TEXT,
  "description" TEXT,
  "equipmentId" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_addresses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ip_addresses_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ip_networks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ip_addresses_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

ALTER TABLE "ip_networks" ADD COLUMN IF NOT EXISTS "gateway" TEXT;

CREATE INDEX IF NOT EXISTS "ip_range_definitions_networkId_idx" ON "ip_range_definitions"("networkId");
CREATE UNIQUE INDEX IF NOT EXISTS "ip_addresses_networkId_ip_key" ON "ip_addresses"("networkId", "ip");
CREATE INDEX IF NOT EXISTS "ip_addresses_networkId_idx" ON "ip_addresses"("networkId");
