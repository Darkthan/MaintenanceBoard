-- Add task scheduling and predecessor relationships.
ALTER TABLE "todos" ADD COLUMN "startAt" TIMESTAMP(3);

CREATE TABLE "todo_dependencies" (
  "predecessorId" TEXT NOT NULL,
  "successorId" TEXT NOT NULL,
  CONSTRAINT "todo_dependencies_pkey" PRIMARY KEY ("predecessorId", "successorId"),
  CONSTRAINT "todo_dependencies_predecessorId_fkey"
    FOREIGN KEY ("predecessorId") REFERENCES "todos" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "todo_dependencies_successorId_fkey"
    FOREIGN KEY ("successorId") REFERENCES "todos" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "todo_dependencies_successorId_idx" ON "todo_dependencies" ("successorId");
