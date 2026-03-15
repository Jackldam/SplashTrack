import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/authz';

export type StudentDetail = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  dateOfBirth: Date | null;
  swimLevel: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  groupMemberships: Array<{
    membershipId: string;
    groupId: string;
    groupName: string;
    swimLevel: string;
    groupIsActive: boolean;
    enrolledAt: Date;
  }>;
};

export async function getStudentDetail(
  authContext: AuthContext,
  studentId: string,
): Promise<StudentDetail | null> {
  if (!authContext.membership) {
    return null;
  }

  const student = await prisma.student.findFirst({
    where: {
      id: studentId,
      organizationId: authContext.membership.organization.id,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      swimLevel: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      groupMemberships: {
        orderBy: { group: { name: 'asc' } },
        select: {
          id: true,
          createdAt: true,
          group: {
            select: {
              id: true,
              name: true,
              swimLevel: true,
              isActive: true,
            },
          },
        },
      },
    },
  });

  if (!student) {
    return null;
  }

  return {
    ...student,
    displayName: `${student.firstName} ${student.lastName}`,
    groupMemberships: student.groupMemberships.map((m) => ({
      membershipId: m.id,
      groupId: m.group.id,
      groupName: m.group.name,
      swimLevel: m.group.swimLevel,
      groupIsActive: m.group.isActive,
      enrolledAt: m.createdAt,
    })),
  };
}
