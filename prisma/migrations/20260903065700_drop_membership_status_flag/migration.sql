/*
  Warnings:

  - You are about to drop the column `status` on the `Membership` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "status";

-- DropEnum
DROP TYPE "MembershipStatus";
