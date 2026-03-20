-- CreateTable: signature_requests
CREATE TABLE "signature_requests" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "orderId"        TEXT NOT NULL,
    "token"          TEXT NOT NULL,
    "signatureId"    TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName"  TEXT NOT NULL,
    "message"        TEXT,
    "status"         TEXT NOT NULL DEFAULT 'PENDING',
    "otpHash"        TEXT,
    "otpExpiresAt"   TIMESTAMPTZ,
    "otpAttempts"    INTEGER NOT NULL DEFAULT 0,
    "signedAt"       TIMESTAMPTZ,
    "ipAddress"      TEXT,
    "userAgent"      TEXT,
    "attachmentId"   TEXT,
    "expiresAt"      TIMESTAMPTZ NOT NULL,
    "createdBy"      TEXT NOT NULL,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "signature_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "signature_requests_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "signature_requests_token_key"       ON "signature_requests"("token");
CREATE UNIQUE INDEX "signature_requests_signatureId_key" ON "signature_requests"("signatureId");
