-- Add organization hierarchy and explicit per-membership capability grants.
ALTER TABLE "Organization" ADD COLUMN "parentOrganizationId" TEXT;

CREATE TABLE "OrganizationMemberCapability" (
    "id" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" TEXT,

    CONSTRAINT "OrganizationMemberCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationMemberCapability_organizationMemberId_capability_key" ON "OrganizationMemberCapability"("organizationMemberId", "capability");
CREATE INDEX "OrganizationMemberCapability_capability_idx" ON "OrganizationMemberCapability"("capability");
CREATE INDEX "OrganizationMemberCapability_grantedByUserId_idx" ON "OrganizationMemberCapability"("grantedByUserId");
CREATE INDEX "Organization_parentOrganizationId_idx" ON "Organization"("parentOrganizationId");

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentOrganizationId_fkey" FOREIGN KEY ("parentOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationMemberCapability" ADD CONSTRAINT "OrganizationMemberCapability_organizationMemberId_fkey" FOREIGN KEY ("organizationMemberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationMemberCapability" ADD CONSTRAINT "OrganizationMemberCapability_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
