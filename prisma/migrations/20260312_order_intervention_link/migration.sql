ALTER TABLE "orders" ADD COLUMN "interventionId" TEXT;

CREATE INDEX "orders_interventionId_idx" ON "orders"("interventionId");
