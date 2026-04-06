CREATE TABLE "intervention_todos" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "interventionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "done" BOOLEAN NOT NULL DEFAULT false,
  "doneAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intervention_todos_interventionId_fkey"
    FOREIGN KEY ("interventionId") REFERENCES "interventions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "intervention_todos_interventionId_idx"
  ON "intervention_todos"("interventionId");
