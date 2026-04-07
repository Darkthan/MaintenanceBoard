-- Create the new standalone todos table
CREATE TABLE IF NOT EXISTS "todos" (
  "id" TEXT NOT NULL,
  "interventionId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "done" BOOLEAN NOT NULL DEFAULT false,
  "doneAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "todos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "todos_interventionId_fkey"
    FOREIGN KEY ("interventionId") REFERENCES "interventions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "todos_interventionId_idx" ON "todos"("interventionId");

-- Migrate existing data from intervention_todos (if it exists)
INSERT INTO "todos" ("id", "interventionId", "title", "description", "dueAt", "done", "doneAt", "createdAt")
SELECT "id", "interventionId", "title", "description", "dueAt", "done", "doneAt", "createdAt"
FROM "intervention_todos"
ON CONFLICT DO NOTHING;

-- Drop old table
DROP TABLE IF EXISTS "intervention_todos";
