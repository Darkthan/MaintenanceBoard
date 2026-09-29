CREATE TABLE "printers" (
  "id" TEXT NOT NULL,
  "serial" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "printers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "printer_jobs" (
  "id" TEXT NOT NULL,
  "printerId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobKind" TEXT NOT NULL,
  "jobName" TEXT,
  "ownerName" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "statusCode" TEXT,
  "color" TEXT,
  "duplex" TEXT,
  "paperSize" TEXT,
  "originalPages" INTEGER,
  "printPages" INTEGER,
  "outputVolume" INTEGER,
  "printCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "printer_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "printer_jobs_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "printers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "printers_serial_key" ON "printers"("serial");
CREATE UNIQUE INDEX "printer_jobs_printerId_jobId_startedAt_key" ON "printer_jobs"("printerId", "jobId", "startedAt");
CREATE INDEX "printer_jobs_startedAt_idx" ON "printer_jobs"("startedAt");
CREATE INDEX "printer_jobs_ownerName_idx" ON "printer_jobs"("ownerName");
CREATE INDEX "printer_jobs_printerId_startedAt_idx" ON "printer_jobs"("printerId", "startedAt");
