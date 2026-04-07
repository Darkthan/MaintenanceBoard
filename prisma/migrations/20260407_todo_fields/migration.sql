-- SQLite: add description and dueAt columns to existing table
ALTER TABLE "intervention_todos" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "intervention_todos" ADD COLUMN IF NOT EXISTS "dueAt" DATETIME;

-- PostgreSQL: create intervention_todos table if not exists (first deploy on PG)
CREATE TABLE IF NOT EXISTS "intervention_todos" (
  "id" TEXT NOT NULL,
  "interventionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "done" BOOLEAN NOT NULL DEFAULT false,
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intervention_todos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "intervention_todos_interventionId_fkey"
    FOREIGN KEY ("interventionId") REFERENCES "interventions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "intervention_todos_interventionId_idx"
  ON "intervention_todos"("interventionId");

-- PostgreSQL: add columns if table already exists (upgrade path)
ALTER TABLE "intervention_todos" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "intervention_todos" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
