ALTER TABLE "interventions" ADD COLUMN "scheduledStartAt" TIMESTAMP(3);
ALTER TABLE "interventions" ADD COLUMN "scheduledEndAt" TIMESTAMP(3);
ALTER TABLE "interventions" ADD COLUMN "dueAt" TIMESTAMP(3);

CREATE INDEX "interventions_scheduledStartAt_idx" ON "interventions"("scheduledStartAt");
CREATE INDEX "interventions_dueAt_idx" ON "interventions"("dueAt");
