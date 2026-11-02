-- AlterTable
ALTER TABLE "loan_reservations" ADD COLUMN     "returnedAt" TIMESTAMP(3),
ADD COLUMN     "returnedById" TEXT,
ADD COLUMN     "returnedByName" TEXT,
ALTER COLUMN "startAt" DROP NOT NULL,
ALTER COLUMN "endAt" DROP NOT NULL;
