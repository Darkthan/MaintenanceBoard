CREATE TABLE "loan_resources" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "description" TEXT,
  "totalUnits" INTEGER NOT NULL DEFAULT 1,
  "bundleSize" INTEGER NOT NULL DEFAULT 1,
  "location" TEXT,
  "instructions" TEXT,
  "color" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "loan_magic_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "title" TEXT,
  "resourceId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" DATETIME,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_magic_links_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "loan_resources" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "loan_magic_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "loan_reservations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resourceId" TEXT NOT NULL,
  "requestLinkId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requesterName" TEXT NOT NULL,
  "requesterEmail" TEXT NOT NULL,
  "requesterPhone" TEXT,
  "requesterOrganization" TEXT,
  "startAt" DATETIME NOT NULL,
  "endAt" DATETIME NOT NULL,
  "requestedUnits" INTEGER NOT NULL,
  "reservedSlots" INTEGER NOT NULL,
  "additionalNeeds" TEXT,
  "notes" TEXT,
  "internalNotes" TEXT,
  "createdById" TEXT,
  "approvedById" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "loan_reservations_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "loan_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "loan_reservations_requestLinkId_fkey" FOREIGN KEY ("requestLinkId") REFERENCES "loan_magic_links" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "loan_reservations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "loan_reservations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "loan_request_access_links" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestLinkId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "requesterName" TEXT,
  "token" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_request_access_links_requestLinkId_fkey" FOREIGN KEY ("requestLinkId") REFERENCES "loan_magic_links" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "loan_magic_links_token_key" ON "loan_magic_links"("token");
CREATE INDEX "loan_magic_links_resourceId_idx" ON "loan_magic_links"("resourceId");
CREATE UNIQUE INDEX "loan_request_access_links_token_key" ON "loan_request_access_links"("token");
CREATE INDEX "loan_request_access_links_requestLinkId_email_idx" ON "loan_request_access_links"("requestLinkId", "email");
CREATE INDEX "loan_request_access_links_expiresAt_idx" ON "loan_request_access_links"("expiresAt");
CREATE INDEX "loan_reservations_resourceId_startAt_endAt_idx" ON "loan_reservations"("resourceId", "startAt", "endAt");
CREATE INDEX "loan_reservations_status_idx" ON "loan_reservations"("status");
