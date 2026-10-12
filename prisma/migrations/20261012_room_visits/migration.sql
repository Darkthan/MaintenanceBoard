CREATE TABLE "room_visits" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "roomId" TEXT NOT NULL,
 "authorId" TEXT,
 "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "observation" TEXT NOT NULL DEFAULT '',
 "damageFound" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "room_visits_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "room_visits_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "room_visits_roomId_visitedAt_idx" ON "room_visits"("roomId", "visitedAt");
CREATE INDEX "room_visits_visitedAt_idx" ON "room_visits"("visitedAt");
