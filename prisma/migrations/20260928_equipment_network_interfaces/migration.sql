CREATE TABLE "equipment_network_interfaces" (
  "id" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "macAddress" TEXT,
  "ipAddressId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "equipment_network_interfaces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "equipment_network_interfaces_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "equipment_network_interfaces_ipAddressId_fkey" FOREIGN KEY ("ipAddressId") REFERENCES "ip_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "equipment_network_interfaces_ipAddressId_key" ON "equipment_network_interfaces"("ipAddressId");
CREATE INDEX "equipment_network_interfaces_equipmentId_idx" ON "equipment_network_interfaces"("equipmentId");
