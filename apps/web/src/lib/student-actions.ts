'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDetail } from '@/lib/student-detail';
import { parseCreateStudentFormData } from '@/lib/student-forms';
import { prisma } from '@/lib/prisma';
import { buildStudentIdentityKey } from '@/lib/student-identity';

export type CreateStudentActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const DEFAULT_CREATE_STUDENT_ACTION_RESULT: CreateStudentActionResult = {
  status: 'idle',
  message: '',
};

export const DEFAULT_UPDATE_STUDENT_ACTION_RESULT: CreateStudentActionResult = {
  status: 'idle',
  message: '',
};

export async function createStudentAction(
  _previousStateUnused: CreateStudentActionResult = DEFAULT_CREATE_STUDENT_ACTION_RESULT,
  formData: FormData,
): Promise<CreateStudentActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return {
      status: 'error',
      message: 'Geen actieve organization membership gevonden.',
    };
  }

  const parsed = parseCreateStudentFormData(formData);

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.message,
    };
  }

  try {
    const student = await prisma.$transaction(async (tx) => {
      const createdStudent = await tx.student.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          dateOfBirth: parsed.data.dateOfBirth,
          identityKey: buildStudentIdentityKey(parsed.data),
          swimLevel: parsed.data.swimLevel,
          isActive: parsed.data.isActive,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          swimLevel: true,
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'student.created',
          entityType: 'student',
          entityId: createdStudent.id,
          metadata: {
            studentId: createdStudent.id,
            firstName: createdStudent.firstName,
            lastName: createdStudent.lastName,
            swimLevel: createdStudent.swimLevel,
            isActive: createdStudent.isActive,
            performedByMembershipId: authContext.membership!.id,
            performedByRole: authContext.membership!.role,
          },
        },
      });

      return createdStudent;
    });

    revalidatePath('/dashboard/students');
    revalidatePath(`/dashboard/students/${student.id}`);
  } catch (error) {
    const isPrismaKnownError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002';

    if (isPrismaKnownError) {
      return {
        status: 'error',
        message:
          'Er bestaat al een student met dezelfde naam en geboortedatum binnen de huidige organization.',
      };
    }

    return {
      status: 'error',
      message: 'Student aanmaken is niet gelukt.',
    };
  }

  redirect('/dashboard/students');
}

export async function updateStudentAction(
  studentId: string,
  _previousStateUnused: CreateStudentActionResult = DEFAULT_UPDATE_STUDENT_ACTION_RESULT,
  formData: FormData,
): Promise<CreateStudentActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return {
      status: 'error',
      message: 'Geen actieve organization membership gevonden.',
    };
  }

  const existingStudent = await getStudentDetail(authContext, studentId);

  if (!existingStudent) {
    return {
      status: 'error',
      message: 'Student niet gevonden binnen de huidige organization.',
    };
  }

  const parsed = parseCreateStudentFormData(formData);

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.message,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updatedStudent = await tx.student.update({
        where: {
          id: existingStudent.id,
        },
        data: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          dateOfBirth: parsed.data.dateOfBirth,
          identityKey: buildStudentIdentityKey(parsed.data),
          swimLevel: parsed.data.swimLevel,
          isActive: parsed.data.isActive,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          swimLevel: true,
          isActive: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'student.updated',
          entityType: 'student',
          entityId: updatedStudent.id,
          metadata: {
            studentId: updatedStudent.id,
            previousStudent: {
              firstName: existingStudent.firstName,
              lastName: existingStudent.lastName,
              dateOfBirth: existingStudent.dateOfBirth?.toISOString() ?? null,
              swimLevel: existingStudent.swimLevel,
              isActive: existingStudent.isActive,
            },
            updatedStudent: {
              firstName: updatedStudent.firstName,
              lastName: updatedStudent.lastName,
              swimLevel: updatedStudent.swimLevel,
              isActive: updatedStudent.isActive,
              dateOfBirth: parsed.data.dateOfBirth?.toISOString() ?? null,
            },
            performedByMembershipId: authContext.membership!.id,
            performedByRole: authContext.membership!.role,
          },
        },
      });
    });

    revalidatePath('/dashboard/students');
    revalidatePath(`/dashboard/students/${studentId}`);
    revalidatePath(`/dashboard/students/${studentId}/edit`);
  } catch (error) {
    const isPrismaKnownError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002';

    if (isPrismaKnownError) {
      return {
        status: 'error',
        message:
          'Er bestaat al een student met dezelfde naam en geboortedatum binnen de huidige organization.',
      };
    }

    return {
      status: 'error',
      message: 'Student bijwerken is niet gelukt.',
    };
  }

  redirect(`/dashboard/students/${studentId}`);
}
