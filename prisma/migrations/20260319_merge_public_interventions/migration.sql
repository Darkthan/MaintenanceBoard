ALTER TABLE "interventions" ADD COLUMN "mergedIntoId" TEXT;

CREATE TABLE "intervention_reporters" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "interventionId" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "token" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intervention_reporters_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "interventions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "intervention_reporters_token_key" ON "intervention_reporters"("token");
CREATE INDEX "intervention_reporters_interventionId_idx" ON "intervention_reporters"("interventionId");
CREATE INDEX "intervention_reporters_email_idx" ON "intervention_reporters"("email");
CREATE INDEX "interventions_mergedIntoId_idx" ON "interventions"("mergedIntoId");

INSERT INTO "intervention_reporters" ("id", "interventionId", "name", "email", "token", "isPrimary", "createdAt")
SELECT
  lower(hex(randomblob(16))),
  "id",
  "reporterName",
  lower("reporterEmail"),
  "reporterToken",
  1,
  "createdAt"
FROM "interventions"
WHERE "source" = 'PUBLIC' AND "reporterToken" IS NOT NULL;
