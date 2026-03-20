ALTER TABLE "interventions" ADD COLUMN "notes" TEXT;

ALTER TABLE "orders" ADD COLUMN "expectedDeliveryAt" TIMESTAMPTZ;
ALTER TABLE "orders" ADD COLUMN "trackingNotes" TEXT;
