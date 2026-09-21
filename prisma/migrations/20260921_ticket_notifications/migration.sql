ALTER TABLE "intervention_reporters" ADD COLUMN "notifyByEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "intervention_reporters" ADD COLUMN "pushSubscription" TEXT;
