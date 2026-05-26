-- AddColumn: archivedAt sur les commandes
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ;
