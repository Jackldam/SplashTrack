/*
  Warnings:

  - You are about to drop the column `organizationId` on the `AuditEvent` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "AuditEvent_organizationId_idx";

-- DropIndex
DROP INDEX "AuditEvent_organizationId_sequence_idx";

-- AlterTable
ALTER TABLE "AuditEvent" DROP COLUMN "organizationId";
