import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';
import type { StudentDirectoryQuery } from '@/lib/student-directory-filters';

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
  filters: StudentDirectoryQuery & {
    matchedStudents: number;
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
  filters: StudentDirectoryQuery,
): Promise<StudentDirectorySummary | null> {
  if (!authContext.membership) {
    return null;
  }

  const organizationId = authContext.membership.organization.id;
  const where = {
    organizationId,
    ...(filters.status === 'active' ? { isActive: true } : {}),
    ...(filters.status === 'inactive' ? { isActive: false } : {}),
    ...(filters.search
      ? {
          OR: [
            {
              firstName: {
                contains: filters.search,
                mode: 'insensitive' as const,
              },
            },
            {
              lastName: {
                contains: filters.search,
                mode: 'insensitive' as const,
              },
            },
            {
              swimLevel: {
                contains: filters.search,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : {}),
  };

  const [totalStudents, activeStudents, students, matchedStudents, levelBreakdown] = await Promise.all([
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
      where,
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
    prisma.student.count({
      where,
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
    filters: {
      ...filters,
      matchedStudents,
    },
    students: students.map((student) => ({
      ...student,
      displayName: `${student.firstName} ${student.lastName}`,
    })),
  };
}
