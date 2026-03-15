import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

import {
  DEMO_ORGANIZATION,
  DEMO_STUDENTS,
  DEMO_SWIM_GROUPS,
  DEMO_SKILLS,
  DEMO_COURSES,
  DEMO_USERS,
  FOUNDATION_SEED_AUDIT,
} from '@/lib/seed-data';
import { buildStudentIdentityKey } from '@/lib/student-identity';

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

  const seededStudents = await Promise.all(
    DEMO_STUDENTS.map((student) => {
      const dateOfBirth = new Date(`${student.dateOfBirth}T00:00:00.000Z`);
      const identityKey = buildStudentIdentityKey({
        firstName: student.firstName,
        lastName: student.lastName,
        dateOfBirth,
      });

      return prisma.student.upsert({
        where: {
          organizationId_identityKey: {
            organizationId: demoOrganization.id,
            identityKey,
          },
        },
        update: {
          firstName: student.firstName,
          lastName: student.lastName,
          dateOfBirth,
          identityKey,
          swimLevel: student.swimLevel,
          isActive: student.isActive,
        },
        create: {
          organizationId: demoOrganization.id,
          firstName: student.firstName,
          lastName: student.lastName,
          dateOfBirth,
          identityKey,
          swimLevel: student.swimLevel,
          isActive: student.isActive,
        },
      });
    }),
  );

  const seededGroups = await Promise.all(
    DEMO_SWIM_GROUPS.map((group) =>
      prisma.swimGroup.upsert({
        where: {
          organizationId_name: {
            organizationId: demoOrganization.id,
            name: group.name,
          },
        },
        update: {
          swimLevel: group.swimLevel,
          isActive: group.isActive,
        },
        create: {
          organizationId: demoOrganization.id,
          name: group.name,
          swimLevel: group.swimLevel,
          isActive: group.isActive,
        },
      }),
    ),
  );

  // Enroll active students whose swimLevel matches a group
  await Promise.all(
    seededStudents
      .filter((s) => s.isActive)
      .flatMap((student) => {
        return seededGroups
          .filter((group) => group.swimLevel === student.swimLevel)
          .map((group) =>
            prisma.groupMembership.upsert({
              where: {
                groupId_studentId: {
                  groupId: group.id,
                  studentId: student.id,
                },
              },
              update: {},
              create: {
                groupId: group.id,
                studentId: student.id,
              },
            }),
          );
      }),
  );

  // Seed skills
  const seededSkills = await Promise.all(
    DEMO_SKILLS.map((skill) =>
      prisma.skill.upsert({
        where: {
          organizationId_name: {
            organizationId: demoOrganization.id,
            name: skill.name,
          },
        },
        update: {
          description: skill.description,
          swimLevel: skill.swimLevel,
          isActive: skill.isActive,
        },
        create: {
          organizationId: demoOrganization.id,
          name: skill.name,
          description: skill.description,
          swimLevel: skill.swimLevel,
          isActive: skill.isActive,
        },
      }),
    ),
  );

  // Seed courses
  const seededCourses = await Promise.all(
    DEMO_COURSES.map((course) =>
      prisma.course.upsert({
        where: {
          organizationId_name: {
            organizationId: demoOrganization.id,
            name: course.name,
          },
        },
        update: {
          description: course.description,
          swimLevel: course.swimLevel,
          isActive: course.isActive,
        },
        create: {
          organizationId: demoOrganization.id,
          name: course.name,
          description: course.description,
          swimLevel: course.swimLevel,
          isActive: course.isActive,
        },
      }),
    ),
  );

  // Link skills to courses whose swimLevel matches
  await Promise.all(
    seededCourses.flatMap((course, index) => {
      const matchingSkills = seededSkills.filter(
        (skill) => skill.swimLevel === DEMO_COURSES[index].swimLevel,
      );
      return matchingSkills.map((skill, sortOrder) =>
        prisma.courseSkill.upsert({
          where: {
            courseId_skillId: {
              courseId: course.id,
              skillId: skill.id,
            },
          },
          update: {},
          create: {
            courseId: course.id,
            skillId: skill.id,
            sortOrder,
          },
        }),
      );
    }),
  );

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
