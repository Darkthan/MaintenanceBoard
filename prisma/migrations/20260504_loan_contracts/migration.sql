ALTER TABLE "loan_reservations" ADD COLUMN "contractSignatureRequestId" TEXT;
ALTER TABLE "loan_reservations" ADD COLUMN "contractBody" TEXT;
ALTER TABLE "loan_reservations" ADD COLUMN "contractGeneratedAt" DATETIME;

CREATE UNIQUE INDEX "loan_reservations_contractSignatureRequestId_key"
  ON "loan_reservations"("contractSignatureRequestId");

CREATE TABLE "loan_reservation_equipments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "loanReservationId" TEXT NOT NULL,
  "equipmentId" TEXT,
  "equipmentName" TEXT NOT NULL,
  "equipmentType" TEXT,
  "equipmentBrand" TEXT,
  "equipmentModel" TEXT,
  "equipmentSerialNumber" TEXT,
  "lotNumber" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_reservation_equipments_loanReservationId_fkey"
    FOREIGN KEY ("loanReservationId") REFERENCES "loan_reservations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loan_reservation_equipments_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "equipment" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "loan_reservation_equipments_loanReservationId_idx"
  ON "loan_reservation_equipments"("loanReservationId");

CREATE INDEX "loan_reservation_equipments_equipmentId_idx"
  ON "loan_reservation_equipments"("equipmentId");
