/*
  Warnings:

  - You are about to drop the `PlatformRoleAssignment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PlatformRoleAssignment" DROP CONSTRAINT "PlatformRoleAssignment_personId_fkey";

-- DropForeignKey
ALTER TABLE "PlatformRoleAssignment" DROP CONSTRAINT "PlatformRoleAssignment_roleId_fkey";

-- DropTable
DROP TABLE "PlatformRoleAssignment";
