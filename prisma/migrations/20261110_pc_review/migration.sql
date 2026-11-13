ALTER TABLE "equipment" ADD COLUMN "hostnameChangeId" TEXT;
ALTER TABLE "equipment" ADD COLUMN "hostnameChangeOld" TEXT;
ALTER TABLE "equipment" ADD COLUMN "hostnameChangeNew" TEXT;
ALTER TABLE "equipment" ADD COLUMN "hostnameChangedAt" TIMESTAMP(3);
CREATE INDEX "equipment_lastSeenAt_idx" ON "equipment"("lastSeenAt");
CREATE INDEX "equipment_hostnameChangeId_idx" ON "equipment"("hostnameChangeId");
