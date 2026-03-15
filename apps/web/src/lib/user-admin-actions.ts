'use server';

import { AuditActorType } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import { isAppRole, validateRoleMutationPolicy } from '@/lib/organization-admin-action-core';
import { prisma } from '@/lib/prisma';
import { getOrganizationUserDetail } from '@/lib/user-admin';

export type UserAdminActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export const DEFAULT_USER_ADMIN_ACTION_RESULT: UserAdminActionResult = {
  status: 'idle',
  message: '',
};

const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  email: z.string().trim().email('E-mailadres is ongeldig.').max(320),
  password: z.string().min(8, 'Wachtwoord moet minimaal 8 tekens hebben.').max(120),
  role: z.enum([APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  email: z.string().trim().email('E-mailadres is ongeldig.').max(320),
  role: z.enum([APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]),
  isActive: z.enum(['true', 'false']),
  password: z
    .string()
    .max(120)
    .refine((val) => val === '' || val.length >= 8, {
      message: 'Wachtwoord moet minimaal 8 tekens hebben.',
    })
    .optional(),
});

export async function createOrganizationUserAction(
  _previousStateUnused: UserAdminActionResult = DEFAULT_USER_ADMIN_ACTION_RESULT,
  formData: FormData,
): Promise<UserAdminActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = createUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' };
  }

  if (parsed.data.role === APP_ROLES.OWNER && authContext.membership.role !== APP_ROLES.OWNER) {
    return { status: 'error', message: 'Alleen owners mogen een nieuwe owner aanmaken.' };
  }

  const email = parsed.data.email.toLowerCase();

  try {
    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email }, select: { id: true } });

      if (existingUser) {
        throw new Error('EMAIL_EXISTS');
      }

      const user = await tx.user.create({
        data: {
          email,
          name: parsed.data.name,
          emailVerified: true,
          isActive: true,
        },
        select: { id: true },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          userId: user.id,
          role: parsed.data.role,
          isActive: true,
        },
      });

      await tx.account.create({
        data: {
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await hashPassword(parsed.data.password),
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'organization.user.created',
          entityType: 'user',
          entityId: user.id,
          metadata: {
            targetUserEmail: email,
            targetUserName: parsed.data.name,
            nextRole: parsed.data.role,
            performedByMembershipId: authContext.membership!.id,
            performedByRole: authContext.membership!.role,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
      return { status: 'error', message: 'Er bestaat al een user met dit e-mailadres.' };
    }

    return { status: 'error', message: 'User aanmaken is niet gelukt.' };
  }

  revalidatePath('/dashboard/organization');
  revalidatePath('/dashboard/organization/users');

  redirect('/dashboard/organization/users');
}

export async function updateOrganizationUserAction(
  membershipId: string,
  _previousStateUnused: UserAdminActionResult = DEFAULT_USER_ADMIN_ACTION_RESULT,
  formData: FormData,
): Promise<UserAdminActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  if (!authContext.membership) {
    return { status: 'error', message: 'Geen actieve organization membership gevonden.' };
  }

  const parsed = updateUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    role: formData.get('role'),
    isActive: formData.get('isActive'),
    password: typeof formData.get('password') === 'string' ? formData.get('password') : undefined,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Ongeldige invoer.' };
  }

  const target = await getOrganizationUserDetail(authContext, membershipId);

  if (!target) {
    return { status: 'error', message: 'User niet gevonden binnen de huidige organization.' };
  }

  const nextRole = parsed.data.role;
  const nextUserIsActive = parsed.data.isActive === 'true';
  const nextEmail = parsed.data.email.toLowerCase();

  if (!isAppRole(nextRole)) {
    return { status: 'error', message: 'Ongeldige rol.' };
  }

  const activeOwnerCount = await prisma.organizationMember.count({
    where: {
      organizationId: authContext.membership.organization.id,
      isActive: true,
      role: APP_ROLES.OWNER,
    },
  });

  const rolePolicy = validateRoleMutationPolicy({
    actorRole: authContext.membership.role,
    actorMembershipId: authContext.membership.id,
    targetMembershipId: target.membershipId,
    currentRole: target.role,
    nextRole,
    activeOwnerCount,
  });

  if (target.role !== nextRole && !rolePolicy.allowed) {
    return { status: 'error', message: rolePolicy.message ?? 'Rolwijziging is niet toegestaan.' };
  }

  if (authContext.membership.id === target.membershipId && !nextUserIsActive) {
    return { status: 'error', message: 'Je kunt je eigen account niet deactiveren.' };
  }

  if (target.role === APP_ROLES.OWNER && nextRole !== APP_ROLES.OWNER && activeOwnerCount <= 1) {
    return { status: 'error', message: 'De laatste actieve owner kan niet worden gedegradeerd.' };
  }

  if (nextRole === APP_ROLES.OWNER && authContext.membership.role !== APP_ROLES.OWNER) {
    return { status: 'error', message: 'Alleen owners mogen een owner toekennen.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const emailOwner = await tx.user.findFirst({
        where: {
          email: nextEmail,
          id: { not: target.userId },
        },
        select: { id: true },
      });

      if (emailOwner) {
        throw new Error('EMAIL_EXISTS');
      }

      await tx.user.update({
        where: { id: target.userId },
        data: {
          name: parsed.data.name,
          email: nextEmail,
          isActive: nextUserIsActive,
        },
      });

      await tx.organizationMember.update({
        where: { id: target.membershipId },
        data: {
          role: nextRole,
          isActive: nextUserIsActive,
        },
      });

      if (parsed.data.password && parsed.data.password.trim().length > 0) {
        await tx.account.updateMany({
          where: {
            userId: target.userId,
            providerId: 'credential',
          },
          data: {
            password: await hashPassword(parsed.data.password),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          organizationId: authContext.membership!.organization.id,
          actorUserId: authContext.session.user.id,
          actorType: AuditActorType.USER,
          action: 'organization.user.updated',
          entityType: 'user',
          entityId: target.userId,
          metadata: {
            targetUserEmail: nextEmail,
            targetUserName: parsed.data.name,
            previousRole: target.role,
            nextRole,
            previousIsActive: target.userIsActive,
            nextIsActive: nextUserIsActive,
            performedByMembershipId: authContext.membership!.id,
            performedByRole: authContext.membership!.role,
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_EXISTS') {
      return { status: 'error', message: 'Er bestaat al een user met dit e-mailadres.' };
    }

    return { status: 'error', message: 'User bijwerken is niet gelukt.' };
  }

  revalidatePath('/dashboard/organization');
  revalidatePath('/dashboard/organization/users');
  revalidatePath(`/dashboard/organization/users/${membershipId}/edit`);

  redirect('/dashboard/organization/users');
}
