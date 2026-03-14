import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

import { DEMO_ORGANIZATION, DEMO_USERS, FOUNDATION_SEED_AUDIT } from '@/lib/seed-data';

const prisma = new PrismaClient();

async function main() {
  const demoOrganization = await prisma.organization.upsert({
    where: { slug: DEMO_ORGANIZATION.slug },
    update: {
      name: DEMO_ORGANIZATION.name,
      isActive: true,
    },
    create: {
      slug: DEMO_ORGANIZATION.slug,
      name: DEMO_ORGANIZATION.name,
      isActive: true,
    },
  });

  const seededUsers = await Promise.all(
    DEMO_USERS.map(async (demoUser) => {
      const user = await prisma.user.upsert({
        where: { email: demoUser.email },
        update: {
          name: demoUser.name,
          emailVerified: true,
          isActive: true,
        },
        create: {
          email: demoUser.email,
          name: demoUser.name,
          emailVerified: true,
          isActive: true,
        },
      });

      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: demoOrganization.id,
            userId: user.id,
          },
        },
        update: {
          role: demoUser.role,
          isActive: true,
        },
        create: {
          organizationId: demoOrganization.id,
          userId: user.id,
          role: demoUser.role,
          isActive: true,
        },
      });

      await prisma.account.upsert({
        where: {
          providerId_accountId: {
            providerId: 'credential',
            accountId: user.id,
          },
        },
        update: {
          password: await hashPassword(demoUser.password),
          userId: user.id,
        },
        create: {
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await hashPassword(demoUser.password),
        },
      });

      return user;
    }),
  );

  const demoOwner = seededUsers.find((user) => user.email === DEMO_USERS[0].email);

  if (!demoOwner) {
    throw new Error('Demo owner missing after seed.');
  }

  const existingSeedLog = await prisma.auditLog.findFirst({
    where: {
      organizationId: demoOrganization.id,
      action: FOUNDATION_SEED_AUDIT.action,
      entityType: FOUNDATION_SEED_AUDIT.entityType,
      entityId: FOUNDATION_SEED_AUDIT.entityId,
    },
    select: { id: true },
  });

  if (existingSeedLog) {
    await prisma.auditLog.update({
      where: { id: existingSeedLog.id },
      data: {
        actorUserId: demoOwner.id,
        actorType: FOUNDATION_SEED_AUDIT.actorType,
        metadata: FOUNDATION_SEED_AUDIT.metadata,
      },
    });
  } else {
    await prisma.auditLog.create({
      data: {
        organizationId: demoOrganization.id,
        actorUserId: demoOwner.id,
        actorType: FOUNDATION_SEED_AUDIT.actorType,
        action: FOUNDATION_SEED_AUDIT.action,
        entityType: FOUNDATION_SEED_AUDIT.entityType,
        entityId: FOUNDATION_SEED_AUDIT.entityId,
        metadata: FOUNDATION_SEED_AUDIT.metadata,
      },
    });
  }

  console.info(
    `Prisma seed completed for ${DEMO_ORGANIZATION.slug} with ${DEMO_USERS.length} demo users.`,
  );
}

main()
  .catch((error) => {
    console.error('Prisma seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
