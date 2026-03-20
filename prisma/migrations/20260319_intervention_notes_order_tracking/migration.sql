ALTER TABLE "interventions" ADD COLUMN "notes" TEXT;

ALTER TABLE "orders" ADD COLUMN "expectedDeliveryAt" DATETIME;
ALTER TABLE "orders" ADD COLUMN "trackingNotes" TEXT;
