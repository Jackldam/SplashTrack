import { PrismaClient, AuditActorType, OrganizationMemberRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const demoOrganization = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {
      name: 'SplashTrack Demo Organization',
      isActive: true,
    },
    create: {
      slug: 'demo-org',
      name: 'SplashTrack Demo Organization',
      isActive: true,
    },
  });

  const demoOwner = await prisma.user.upsert({
    where: { email: 'demo.owner@splashtrack.local' },
    update: {
      name: 'Demo Owner',
      isActive: true,
    },
    create: {
      email: 'demo.owner@splashtrack.local',
      name: 'Demo Owner',
      isActive: true,
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: demoOrganization.id,
        userId: demoOwner.id,
      },
    },
    update: {
      role: OrganizationMemberRole.OWNER,
      isActive: true,
    },
    create: {
      organizationId: demoOrganization.id,
      userId: demoOwner.id,
      role: OrganizationMemberRole.OWNER,
      isActive: true,
    },
  });

  const existingSeedLog = await prisma.auditLog.findFirst({
    where: {
      organizationId: demoOrganization.id,
      action: 'foundation.seeded',
      entityType: 'system',
      entityId: 'demo-org',
    },
    select: { id: true },
  });

  if (!existingSeedLog) {
    await prisma.auditLog.create({
      data: {
        organizationId: demoOrganization.id,
        actorUserId: demoOwner.id,
        actorType: AuditActorType.USER,
        action: 'foundation.seeded',
        entityType: 'system',
        entityId: 'demo-org',
        metadata: {
          note: 'Idempotent Prisma foundation seed for local/demo environments only.',
          futureAdminSeed: {
            enabled: false,
            reason: 'Auth/login flow intentionally not part of batch 2 foundation.',
          },
        },
      },
    });
  }

  console.info('Prisma seed completed for demo organization foundation.');
}

main()
  .catch((error) => {
    console.error('Prisma seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
