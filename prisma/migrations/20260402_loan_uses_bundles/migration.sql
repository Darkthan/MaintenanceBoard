-- AlterTable: add usesBundles column to loan_resources
ALTER TABLE "loan_resources" ADD COLUMN IF NOT EXISTS "usesBundles" BOOLEAN NOT NULL DEFAULT true;
