-- DropForeignKey
ALTER TABLE "OrganizationMembership" DROP CONSTRAINT "OrganizationMembership_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Role" DROP CONSTRAINT "Role_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "OrganizationUnit" DROP CONSTRAINT "OrganizationUnit_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "AccessGroup" DROP CONSTRAINT "AccessGroup_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "RoleAssignment" DROP CONSTRAINT "RoleAssignment_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ApiCredential" DROP CONSTRAINT "ApiCredential_organizationId_fkey";

-- DropIndex
DROP INDEX "OrganizationMembership_organizationId_idx";

-- DropIndex
DROP INDEX "OrganizationMembership_personId_idx";

-- DropIndex
DROP INDEX "OrganizationMembership_personId_organizationId_key";

-- DropIndex
DROP INDEX "Role_organizationId_idx";

-- DropIndex
DROP INDEX "OrganizationUnit_organizationId_idx";

-- DropIndex
DROP INDEX "OrganizationUnit_organizationId_path_idx";

-- DropIndex
DROP INDEX "AccessGroup_organizationId_idx";

-- DropIndex
DROP INDEX "RoleAssignment_organizationId_idx";

-- DropIndex
DROP INDEX "RoleAssignment_personId_roleId_organizationId_unitId_key";

-- DropIndex
DROP INDEX "ApiCredential_organizationId_idx";

-- AlterTable
ALTER TABLE "OrganizationMembership" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "OrganizationUnit" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "AccessGroup" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "RoleAssignment" DROP COLUMN "organizationId";

-- AlterTable
ALTER TABLE "ApiCredential" DROP COLUMN "organizationId";

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_personId_key" ON "OrganizationMembership"("personId");

-- CreateIndex
CREATE INDEX "OrganizationUnit_path_idx" ON "OrganizationUnit"("path");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_personId_roleId_unitId_key" ON "RoleAssignment"("personId", "roleId", "unitId");

