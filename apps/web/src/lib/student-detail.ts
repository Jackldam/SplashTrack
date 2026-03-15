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
    },
  });

  if (!student) {
    return null;
  }

  return {
    ...student,
    displayName: `${student.firstName} ${student.lastName}`,
  };
}
