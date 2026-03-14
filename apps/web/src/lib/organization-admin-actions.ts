'use server';

import { AuditActorType } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { APP_ROLES, CAPABILITIES, requireAuthContext } from '@/lib/authz';
import {
  DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  isOrganizationMembershipMutationAction,
  ORGANIZATION_ADMIN_ACTIONS,
  type OrganizationAdminActionResult,
} from '@/lib/organization-admin-action-core';
import { prisma } from '@/lib/prisma';

export { DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT, ORGANIZATION_ADMIN_ACTIONS };
export type { OrganizationAdminActionResult };

export async function executeOrganizationMembershipAction(
  _previousStateUnused: OrganizationAdminActionResult = DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT,
  formData: FormData,
): Promise<OrganizationAdminActionResult> {
  void _previousStateUnused;

  const authContext = await requireAuthContext({
    capability: CAPABILITIES.organizationAdmin,
    roles: [APP_ROLES.OWNER, APP_ROLES.ADMIN],
  });

  const action = formData.get('action');
  const membershipId = formData.get('membershipId');

  if (typeof action !== 'string' || typeof membershipId !== 'string') {
    return {
      status: 'error',
      message: 'Ongeldige admin-action payload.',
    };
  }

  if (!isOrganizationMembershipMutationAction(action)) {
    return {
      status: 'error',
      message: 'Deze admin-action is nog niet beschikbaar in batch 7.',
    };
  }

  const membership = await prisma.organizationMember.findFirst({
    where: {
      id: membershipId,
      organizationId: authContext.membership?.organization.id,
    },
    select: {
      id: true,
      role: true,
      isActive: true,
      userId: true,
      user: {
        select: {
          email: true,
          name: true,
        },
      },
      organization: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!membership) {
    return {
      status: 'error',
      message: 'Membership niet gevonden binnen jouw organization.',
    };
  }

  if (
    membership.id === authContext.membership?.id &&
    action === ORGANIZATION_ADMIN_ACTIONS.deactivateMembership
  ) {
    return {
      status: 'error',
      message: 'Je kunt je eigen actieve admin-membership niet deactiveren.',
    };
  }

  const nextIsActive = action === ORGANIZATION_ADMIN_ACTIONS.activateMembership;

  if (membership.isActive === nextIsActive) {
    return {
      status: 'success',
      message: nextIsActive ? 'Membership was al actief.' : 'Membership was al inactief.',
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({
      where: { id: membership.id },
      data: { isActive: nextIsActive },
    });

    await tx.auditLog.create({
      data: {
        organizationId: membership.organization.id,
        actorUserId: authContext.session.user.id,
        actorType: AuditActorType.USER,
        action: nextIsActive
          ? 'organization.membership.activated'
          : 'organization.membership.deactivated',
        entityType: 'organization_membership',
        entityId: membership.id,
        metadata: {
          membershipId: membership.id,
          targetUserId: membership.userId,
          targetUserEmail: membership.user.email,
          targetUserName: membership.user.name,
          previousIsActive: membership.isActive,
          nextIsActive,
          targetRole: membership.role,
          performedByMembershipId: authContext.membership?.id,
          preparedHooks: [ORGANIZATION_ADMIN_ACTIONS.viewRole],
        },
      },
    });
  });

  revalidatePath('/dashboard/organization');

  return {
    status: 'success',
    message: nextIsActive
      ? `Membership van ${membership.user.email} is geactiveerd.`
      : `Membership van ${membership.user.email} is gedeactiveerd.`,
  };
}
