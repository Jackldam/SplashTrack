'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { prisma } from '@/lib/prisma';
import { parseCreateSkillFormData, parseUpdateSkillFormData } from '@/lib/skill-forms';
import { getSkillDetail } from '@/lib/skill-admin';

export type SkillActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

const DEFAULT_SKILL_ACTION_RESULT: SkillActionResult = {
  status: 'idle',
  message: '',
};

export async function createSkillAction(
  _previousStateUnused: SkillActionResult = DEFAULT_SKILL_ACTION_RESULT,
  formData: FormData,
): Promise<SkillActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseCreateSkillFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.skill.findUnique({
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
      message: `Een vaardigheid met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  const skill = await prisma.$transaction(async (tx) => {
    const created = await tx.skill.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
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
        action: 'skill.created',
        entityType: 'skill',
        entityId: created.id,
        metadata: {
          skillId: created.id,
          name: created.name,
          swimLevel: parsed.data.swimLevel,
          isActive: parsed.data.isActive,
        },
      },
    });

    return created;
  });

  revalidatePath('/dashboard/skills');
  redirect(`/dashboard/skills/${skill.id}`);
}

export async function updateSkillAction(
  skillId: string,
  _previousStateUnused: SkillActionResult = DEFAULT_SKILL_ACTION_RESULT,
  formData: FormData,
): Promise<SkillActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = parseUpdateSkillFormData(formData);

  if (!parsed.success) {
    return { status: 'error', message: parsed.message };
  }

  const organizationId = authContext.membership.organization.id;

  const existing = await prisma.skill.findFirst({
    where: { id: skillId, organizationId },
    select: { id: true, name: true, swimLevel: true, isActive: true },
  });

  if (!existing) {
    return { status: 'error', message: 'Vaardigheid niet gevonden.' };
  }

  const nameConflict = await prisma.skill.findFirst({
    where: {
      organizationId,
      name: parsed.data.name,
      id: { not: skillId },
    },
    select: { id: true },
  });

  if (nameConflict) {
    return {
      status: 'error',
      message: `Een andere vaardigheid met de naam "${parsed.data.name}" bestaat al in deze organization.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.skill.update({
      where: { id: skillId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        swimLevel: parsed.data.swimLevel,
        isActive: parsed.data.isActive,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: 'skill.updated',
        entityType: 'skill',
        entityId: skillId,
        metadata: {
          skillId,
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

  revalidatePath(`/dashboard/skills/${skillId}`);
  revalidatePath('/dashboard/skills');
  redirect(`/dashboard/skills/${skillId}`);
}

export async function toggleSkillLifecycleAction(
  skillId: string,
  _previousStateUnused: SkillActionResult = DEFAULT_SKILL_ACTION_RESULT,
  _formData: FormData,
): Promise<SkillActionResult> {
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

  const existing = await getSkillDetail(authContext, skillId);

  if (!existing) {
    return { status: 'error', message: 'Vaardigheid niet gevonden.' };
  }

  const nextIsActive = !existing.isActive;
  const auditAction = nextIsActive ? 'skill.activated' : 'skill.deactivated';

  await prisma.$transaction(async (tx) => {
    await tx.skill.update({
      where: { id: skillId },
      data: { isActive: nextIsActive },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: auditAction,
        entityType: 'skill',
        entityId: skillId,
        metadata: {
          skillId,
          name: existing.name,
          isActive: nextIsActive,
        },
      },
    });
  });

  revalidatePath(`/dashboard/skills/${skillId}`);
  revalidatePath('/dashboard/skills');

  return {
    status: 'success',
    message: nextIsActive
      ? `Vaardigheid "${existing.name}" is opnieuw geactiveerd.`
      : `Vaardigheid "${existing.name}" is gedeactiveerd.`,
  };
}
