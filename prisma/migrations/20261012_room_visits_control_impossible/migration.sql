ALTER TABLE "room_visits" ADD COLUMN "controlImpossible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "room_visits" ADD COLUMN "controlImpossibleReason" TEXT NOT NULL DEFAULT '';
