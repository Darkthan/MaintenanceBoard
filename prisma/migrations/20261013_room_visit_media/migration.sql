CREATE TABLE "room_visit_media" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomVisitId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "storedAs" TEXT NOT NULL,
  "mimetype" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "uploadedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_visit_media_roomVisitId_fkey" FOREIGN KEY ("roomVisitId") REFERENCES "room_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "room_visit_media_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "room_visit_media_storedAs_key" ON "room_visit_media"("storedAs");
CREATE INDEX "room_visit_media_roomVisitId_idx" ON "room_visit_media"("roomVisitId");
