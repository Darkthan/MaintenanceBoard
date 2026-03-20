CREATE TABLE "order_attachments" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "orderId"    TEXT NOT NULL,
    "filename"   TEXT NOT NULL,
    "storedAs"   TEXT NOT NULL,
    "mimetype"   TEXT NOT NULL,
    "size"       INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_attachments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "order_attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
