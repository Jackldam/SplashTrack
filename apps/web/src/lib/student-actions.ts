'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { getStudentDetail } from '@/lib/student-detail';
import { parseCreateStudentFormData } from '@/lib/student-forms';
import { prisma } from '@/lib/prisma';
import { buildStudentIdentityKey } from '@/lib/student-identity';
import {
  buildStudentDuplicateConflictMessage,
  isStudentDuplicateConflictError,
} from '@/lib/student-duplicate-policy';
import {
  DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT,
  resolveStudentLifecycleCopy,
} from '@/lib/student-lifecycle';
import { STUDENT_DELETE_POLICY } from '@/lib/student-policy';

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

export { DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT };

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

  const identityKey = buildStudentIdentityKey(parsed.data);

  try {
    const student = await prisma.$transaction(async (tx) => {
      const createdStudent = await tx.student.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          dateOfBirth: parsed.data.dateOfBirth,
          identityKey,
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
            dateOfBirth: parsed.data.dateOfBirth?.toISOString() ?? null,
            identityKey,
            swimLevel: createdStudent.swimLevel,
            isActive: createdStudent.isActive,
            lifecyclePolicy: STUDENT_DELETE_POLICY.archiveMode,
            hardDeleteEnabled: STUDENT_DELETE_POLICY.hardDeleteEnabled,
            uniquenessIncludesInactiveRecords: STUDENT_DELETE_POLICY.uniquenessIncludesInactiveRecords,
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
    if (isStudentDuplicateConflictError(error)) {
      return {
        status: 'error',
        message: buildStudentDuplicateConflictMessage(parsed.data),
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

  const nextIdentityKey = buildStudentIdentityKey(parsed.data);
  const previousIdentityKey = buildStudentIdentityKey(existingStudent);

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
          identityKey: nextIdentityKey,
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
              identityKey: previousIdentityKey,
              swimLevel: existingStudent.swimLevel,
              isActive: existingStudent.isActive,
            },
            updatedStudent: {
              firstName: updatedStudent.firstName,
              lastName: updatedStudent.lastName,
              swimLevel: updatedStudent.swimLevel,
              isActive: updatedStudent.isActive,
              dateOfBirth: parsed.data.dateOfBirth?.toISOString() ?? null,
              identityKey: nextIdentityKey,
            },
            lifecyclePolicy: STUDENT_DELETE_POLICY.archiveMode,
            hardDeleteEnabled: STUDENT_DELETE_POLICY.hardDeleteEnabled,
            uniquenessIncludesInactiveRecords: STUDENT_DELETE_POLICY.uniquenessIncludesInactiveRecords,
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
    if (isStudentDuplicateConflictError(error)) {
      return {
        status: 'error',
        message: buildStudentDuplicateConflictMessage(parsed.data),
      };
    }

    return {
      status: 'error',
      message: 'Student bijwerken is niet gelukt.',
    };
  }

  redirect(`/dashboard/students/${studentId}`);
}

export async function updateStudentLifecycleAction(
  studentId: string,
  _previousStateUnused = DEFAULT_STUDENT_LIFECYCLE_ACTION_RESULT,
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

  const lifecycleCopy = resolveStudentLifecycleCopy(existingStudent.isActive);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: {
          id: existingStudent.id,
        },
        data: {
          isActive: lifecycleCopy.nextIsActive,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: lifecycleCopy.auditAction,
          entityType: 'student',
          entityId: existingStudent.id,
          metadata: {
            studentId: existingStudent.id,
            previousIsActive: existingStudent.isActive,
            nextIsActive: lifecycleCopy.nextIsActive,
            identityKey: buildStudentIdentityKey(existingStudent),
            lifecyclePolicy: STUDENT_DELETE_POLICY.archiveMode,
            hardDeleteEnabled: STUDENT_DELETE_POLICY.hardDeleteEnabled,
            uniquenessIncludesInactiveRecords: STUDENT_DELETE_POLICY.uniquenessIncludesInactiveRecords,
            performedByMembershipId: authContext.membership!.id,
            performedByRole: authContext.membership!.role,
          },
        },
      });
    });
  } catch {
    return {
      status: 'error',
      message: 'Studentstatus wijzigen is niet gelukt.',
    };
  }

  revalidatePath('/dashboard/students');
  revalidatePath(`/dashboard/students/${studentId}`);
  revalidatePath(`/dashboard/students/${studentId}/edit`);

  return {
    status: 'success',
    message: lifecycleCopy.successMessage,
  };
}
