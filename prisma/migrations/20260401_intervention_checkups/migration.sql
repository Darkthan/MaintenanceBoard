ALTER TABLE "interventions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "interventions" ADD COLUMN "checkupTemplate" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "intervention_checkup_items" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "interventionId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "checklistState" TEXT NOT NULL DEFAULT '[]',
  "notes" TEXT,
  "checkedAt" DATETIME,
  "checkedById" TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "intervention_checkup_items_interventionId_fkey"
    FOREIGN KEY ("interventionId") REFERENCES "interventions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intervention_checkup_items_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "equipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "intervention_checkup_items_checkedById_fkey"
    FOREIGN KEY ("checkedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "intervention_checkup_items_interventionId_equipmentId_key"
  ON "intervention_checkup_items"("interventionId", "equipmentId");

CREATE INDEX "intervention_checkup_items_interventionId_status_orderIndex_idx"
  ON "intervention_checkup_items"("interventionId", "status", "orderIndex");

CREATE INDEX "intervention_checkup_items_equipmentId_idx"
  ON "intervention_checkup_items"("equipmentId");
