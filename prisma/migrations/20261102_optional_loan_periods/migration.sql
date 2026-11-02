-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_loan_reservations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "requestLinkId" TEXT,
    "contractSignatureRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "requesterPhone" TEXT,
    "requesterOrganization" TEXT,
    "startAt" DATETIME,
    "endAt" DATETIME,
    "requestedUnits" INTEGER NOT NULL,
    "reservedSlots" INTEGER NOT NULL,
    "additionalNeeds" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "contractBody" TEXT,
    "contractGeneratedAt" DATETIME,
    "createdById" TEXT,
    "approvedById" TEXT,
    "returnedAt" DATETIME,
    "returnedById" TEXT,
    "returnedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "loan_reservations_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "loan_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "loan_reservations_requestLinkId_fkey" FOREIGN KEY ("requestLinkId") REFERENCES "loan_magic_links" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loan_reservations_contractSignatureRequestId_fkey" FOREIGN KEY ("contractSignatureRequestId") REFERENCES "signature_requests" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loan_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "loan_reservations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_loan_reservations" ("additionalNeeds", "approvedById", "contractBody", "contractGeneratedAt", "contractSignatureRequestId", "createdAt", "createdById", "endAt", "id", "internalNotes", "notes", "requestLinkId", "requestedUnits", "requesterEmail", "requesterName", "requesterOrganization", "requesterPhone", "reservedSlots", "resourceId", "startAt", "status", "updatedAt") SELECT "additionalNeeds", "approvedById", "contractBody", "contractGeneratedAt", "contractSignatureRequestId", "createdAt", "createdById", "endAt", "id", "internalNotes", "notes", "requestLinkId", "requestedUnits", "requesterEmail", "requesterName", "requesterOrganization", "requesterPhone", "reservedSlots", "resourceId", "startAt", "status", "updatedAt" FROM "loan_reservations";
DROP TABLE "loan_reservations";
ALTER TABLE "new_loan_reservations" RENAME TO "loan_reservations";
CREATE UNIQUE INDEX "loan_reservations_contractSignatureRequestId_key" ON "loan_reservations"("contractSignatureRequestId");
CREATE INDEX "loan_reservations_resourceId_startAt_endAt_idx" ON "loan_reservations"("resourceId", "startAt", "endAt");
CREATE INDEX "loan_reservations_status_idx" ON "loan_reservations"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
