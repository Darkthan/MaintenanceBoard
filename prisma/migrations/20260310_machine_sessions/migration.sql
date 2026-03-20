-- CreateTable: machine_session_logs
CREATE TABLE "machine_session_logs" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "winUser"     TEXT NOT NULL,
    "event"       TEXT NOT NULL DEFAULT 'LOGIN',
    "occurredAt"  TIMESTAMPTZ NOT NULL,
    CONSTRAINT "machine_session_logs_equipmentId_fkey"
        FOREIGN KEY ("equipmentId") REFERENCES "equipment" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "machine_session_logs_equipmentId_idx" ON "machine_session_logs"("equipmentId");
CREATE INDEX "machine_session_logs_occurredAt_idx" ON "machine_session_logs"("occurredAt");
