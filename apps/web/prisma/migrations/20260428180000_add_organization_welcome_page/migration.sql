-- CreateTable
CREATE TABLE "OrganizationWelcomePage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT,
    "ctaHref" TEXT,
    "cards" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "OrganizationWelcomePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationWelcomePage_organizationId_key" ON "OrganizationWelcomePage"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationWelcomePage_organizationId_updatedAt_idx" ON "OrganizationWelcomePage"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "OrganizationWelcomePage_createdById_idx" ON "OrganizationWelcomePage"("createdById");

-- CreateIndex
CREATE INDEX "OrganizationWelcomePage_updatedById_idx" ON "OrganizationWelcomePage"("updatedById");

-- AddForeignKey
ALTER TABLE "OrganizationWelcomePage" ADD CONSTRAINT "OrganizationWelcomePage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationWelcomePage" ADD CONSTRAINT "OrganizationWelcomePage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationWelcomePage" ADD CONSTRAINT "OrganizationWelcomePage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
