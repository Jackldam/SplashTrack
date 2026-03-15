'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { parseCreateSwimGroupFormData, parseUpdateSwimGroupFormData } from '@/lib/swim-group-forms';
import { getSwimGroupDetail } from '@/lib/swim-group-admin';

export type SwimGroupActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const DEFAULT_SWIM_GROUP_ACTION_RESULT: SwimGroupActionResult = {
  status: 'idle',
  message: '',
};

export async function createSwimGroupAction(
  _previousStateUnused: SwimGroupActionResult = DEFAULT_SWIM_GROUP_ACTION_RESULT,
  formData: FormData,
): Promise<SwimGroupActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseCreateSwimGroupFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.swimGroup.findUnique({
    where: {
      organizationId_name: {
        organizationId,
        name: parsed.data.name,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      status: 'error',
      message: `Een groep met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.swimGroup.create({
      data: {
        organizationId,
        name: parsed.data.name,
        swimLevel: parsed.data.swimLevel,
        isActive: parsed.data.isActive,
      },
      select: { id: true, name: true },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'swim_group.created',
        entityType: 'swim_group',
        entityId: created.id,
        metadata: {
          groupId: created.id,
          name: created.name,
          swimLevel: parsed.data.swimLevel,
          isActive: parsed.data.isActive,
        },
      },
    });

    return created;
  });

  revalidatePath('/dashboard/groups');
  redirect(`/dashboard/groups/${group.id}`);
}

export async function updateSwimGroupAction(
  groupId: string,
  _previousStateUnused: SwimGroupActionResult = DEFAULT_SWIM_GROUP_ACTION_RESULT,
  formData: FormData,
): Promise<SwimGroupActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseUpdateSwimGroupFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.swimGroup.findFirst({
    where: { id: groupId, organizationId },
    select: { id: true, name: true, swimLevel: true, isActive: true },
  });

  if (!existing) {
    return { status: 'error', message: 'Groep niet gevonden.' };
  }

  const nameConflict = await prisma.swimGroup.findFirst({
    where: {
      organizationId,
      name: parsed.data.name,
      id: { not: groupId },
    },
    select: { id: true },
  });

  if (nameConflict) {
    return {
      status: 'error',
      message: `Een andere groep met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.swimGroup.update({
      where: { id: groupId },
      data: {
        name: parsed.data.name,
        swimLevel: parsed.data.swimLevel,
        isActive: parsed.data.isActive,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'swim_group.updated',
        entityType: 'swim_group',
        entityId: groupId,
        metadata: {
          groupId,
          before: {
            name: existing.name,
            swimLevel: existing.swimLevel,
            isActive: existing.isActive,
          },
          after: {
            name: parsed.data.name,
            swimLevel: parsed.data.swimLevel,
            isActive: parsed.data.isActive,
          },
        },
      },
    });
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath('/dashboard/groups');
  redirect(`/dashboard/groups/${groupId}`);
}

export async function enrollStudentAction(
  groupId: string,
  _previousStateUnused: SwimGroupActionResult = DEFAULT_SWIM_GROUP_ACTION_RESULT,
  formData: FormData,
): Promise<SwimGroupActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const studentId = formData.get('studentId');

  if (typeof studentId !== 'string' || !studentId) {
    return { status: 'error', message: 'Geen student geselecteerd.' };
  }

  const group = await prisma.swimGroup.findFirst({
    where: { id: groupId, organizationId },
    select: { id: true, name: true },
  });

  if (!group) {
    return { status: 'error', message: 'Groep niet gevonden.' };
  }

  const student = await prisma.student.findFirst({
    where: { id: studentId, organizationId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!student) {
    return { status: 'error', message: 'Student niet gevonden.' };
  }

  const alreadyEnrolled = await prisma.groupMembership.findUnique({
    where: { groupId_studentId: { groupId, studentId } },
    select: { id: true },
  });

  if (alreadyEnrolled) {
    return { status: 'error', message: 'Student is al ingeschreven in deze groep.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupMembership.create({
      data: { groupId, studentId },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'swim_group.student_enrolled',
        entityType: 'swim_group',
        entityId: groupId,
        metadata: {
          groupId,
          groupName: group.name,
          studentId,
          studentName: `${student.firstName} ${student.lastName}`,
        },
      },
    });
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/students/${studentId}`);

  return { status: 'success', message: `${student.firstName} ${student.lastName} is ingeschreven in ${group.name}.` };
}

export async function removeStudentFromGroupAction(
  groupId: string,
  _previousStateUnused: SwimGroupActionResult = DEFAULT_SWIM_GROUP_ACTION_RESULT,
  formData: FormData,
): Promise<SwimGroupActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;
  const studentId = formData.get('studentId');

  if (typeof studentId !== 'string' || !studentId) {
    return { status: 'error', message: 'Geen student opgegeven.' };
  }

  const membership = await prisma.groupMembership.findFirst({
    where: {
      groupId,
      studentId,
      group: { organizationId },
    },
    select: {
      id: true,
      group: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
    },
  });

  if (!membership) {
    return { status: 'error', message: 'Inschrijving niet gevonden.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupMembership.delete({ where: { id: membership.id } });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'swim_group.student_removed',
        entityType: 'swim_group',
        entityId: groupId,
        metadata: {
          groupId,
          groupName: membership.group.name,
          studentId,
          studentName: `${membership.student.firstName} ${membership.student.lastName}`,
        },
      },
    });
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath(`/dashboard/students/${studentId}`);

  return {
    status: 'success',
    message: `${membership.student.firstName} ${membership.student.lastName} is uitgeschreven uit ${membership.group.name}.`,
  };
}

export async function toggleSwimGroupLifecycleAction(
  groupId: string,
  _previousStateUnused: SwimGroupActionResult = DEFAULT_SWIM_GROUP_ACTION_RESULT,
  _formData: FormData,
): Promise<SwimGroupActionResult> {
  void _previousStateUnused;
  void _formData;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await getSwimGroupDetail(authContext, groupId);

  if (!existing) {
    return { status: 'error', message: 'Groep niet gevonden.' };
  }

  const nextIsActive = !existing.isActive;
  const auditAction = nextIsActive ? 'swim_group.activated' : 'swim_group.deactivated';

  await prisma.$transaction(async (tx) => {
    await tx.swimGroup.update({
      where: { id: groupId },
      data: { isActive: nextIsActive },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: auditAction,
        entityType: 'swim_group',
        entityId: groupId,
        metadata: {
          groupId,
          name: existing.name,
          isActive: nextIsActive,
        },
      },
    });
  });

  revalidatePath(`/dashboard/groups/${groupId}`);
  revalidatePath('/dashboard/groups');

  return {
    status: 'success',
    message: nextIsActive
      ? `Groep "${existing.name}" is opnieuw geactiveerd.`
      : `Groep "${existing.name}" is gedeactiveerd.`,
  };
}
