import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type StudentDirectorySummary = {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  metrics: {
    totalStudents: number;
    activeStudents: number;
    inactiveStudents: number;
    levelSpread: Array<{
      swimLevel: string;
      count: number;
    }>;
  };
  students: Array<{
    id: string;
    firstName: string;
    lastName: string;
    displayName: string;
    dateOfBirth: Date | null;
    swimLevel: string;
    isActive: boolean;
    createdAt: Date;
  }>;
};

export async function getStudentDirectorySummary(
  authContext: AuthContext,
): Promise<StudentDirectorySummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;

  const [totalStudents, activeStudents, students, levelBreakdown] = await Promise.all([
    prisma.student.count({
      where: {
        organizationId,
      },
    }),
    prisma.student.count({
      where: {
        organizationId,
        isActive: true,
      },
    }),
    prisma.student.findMany({
      where: {
        organizationId,
      },
      orderBy: [
        {
          isActive: 'desc',
        },
        {
          lastName: 'asc',
        },
        {
          firstName: 'asc',
        },
      ],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        swimLevel: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.student.groupBy({
      by: ['swimLevel'],
      where: {
        organizationId,
        isActive: true,
      },
      _count: {
        swimLevel: true,
      },
      orderBy: {
        swimLevel: 'asc',
      },
    }),
  ]);

  return {
    organization: authContext.membership.organization,
    metrics: {
      totalStudents,
      activeStudents,
      inactiveStudents: totalStudents - activeStudents,
      levelSpread: levelBreakdown.map((entry) => ({
        swimLevel: entry.swimLevel,
        count: entry._count.swimLevel,
      })),
    },
    students: students.map((student) => ({
      ...student,
      displayName: `${student.firstName} ${student.lastName}`,
    })),
  };
}
