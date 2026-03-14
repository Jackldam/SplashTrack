import { OrganizationMemberRole } from '@prisma/client';

export const APP_ROLES = {
  OWNER: OrganizationMemberRole.OWNER,
  ADMIN: OrganizationMemberRole.ADMIN,
  MEMBER: OrganizationMemberRole.MEMBER,
} as const;

export type AppRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];

export const ORGANIZATION_ADMIN_ACTIONS = {
  activateMembership: 'membership.activate',
  deactivateMembership: 'membership.deactivate',
  updateMembershipRole: 'membership.update-role',
  viewRole: 'membership.view-role',
} as const;

export type OrganizationAdminActionId =
  (typeof ORGANIZATION_ADMIN_ACTIONS)[keyof typeof ORGANIZATION_ADMIN_ACTIONS];

export type OrganizationAdminActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export type RoleMutationPolicyResult = {
  allowed: boolean;
  message?: string;
};

export function isOrganizationMembershipMutationAction(
  action: string,
): action is 'membership.activate' | 'membership.deactivate' | 'membership.update-role' {
  return (
    action === ORGANIZATION_ADMIN_ACTIONS.activateMembership ||
    action === ORGANIZATION_ADMIN_ACTIONS.deactivateMembership ||
    action === ORGANIZATION_ADMIN_ACTIONS.updateMembershipRole
  );
}

export function isAppRole(value: string): value is AppRole {
  return value === APP_ROLES.OWNER || value === APP_ROLES.ADMIN || value === APP_ROLES.MEMBER;
}

export function canManageMembershipRoles(actorRole: AppRole) {
  return actorRole === APP_ROLES.OWNER;
}

export function canEditRoleTarget(actorRole: AppRole, targetRole: AppRole) {
  if (actorRole === APP_ROLES.OWNER) {
    return true;
  }

  if (actorRole === APP_ROLES.ADMIN) {
    return targetRole === APP_ROLES.MEMBER;
  }

  return false;
}

export function validateRoleMutationPolicy(input: {
  actorRole: AppRole;
  actorMembershipId: string;
  targetMembershipId: string;
  currentRole: AppRole;
  nextRole: AppRole;
  activeOwnerCount: number;
}) : RoleMutationPolicyResult {
  if (!canManageMembershipRoles(input.actorRole)) {
    return {
      allowed: false,
      message: 'Alleen owners mogen membership-rollen wijzigen.',
    };
  }

  if (!canEditRoleTarget(input.actorRole, input.currentRole)) {
    return {
      allowed: false,
      message: 'Je mag deze membership-rol niet wijzigen.',
    };
  }

  if (input.currentRole === input.nextRole) {
    return {
      allowed: true,
      message: 'Membership had deze rol al.',
    };
  }

  if (input.actorMembershipId === input.targetMembershipId) {
    return {
      allowed: false,
      message: 'Je kunt je eigen membership-rol niet wijzigen.',
    };
  }

  if (
    input.currentRole === APP_ROLES.OWNER &&
    input.nextRole !== APP_ROLES.OWNER &&
    input.activeOwnerCount <= 1
  ) {
    return {
      allowed: false,
      message: 'De laatste actieve owner kan niet worden gedegradeerd.',
    };
  }

  return {
    allowed: true,
  };
}

export function resolveMembershipActionAvailability(input: {
  isActive: boolean;
  isCurrentMembership: boolean;
  currentUserRole: AppRole;
  targetRole: AppRole;
}) {
  const canManageRoles = canManageMembershipRoles(input.currentUserRole);
  const canManageTargetRole = canEditRoleTarget(input.currentUserRole, input.targetRole);

  return {
    canActivate: !input.isActive,
    canDeactivate: input.isActive && !input.isCurrentMembership,
    canManageRoles:
      canManageRoles && canManageTargetRole && !input.isCurrentMembership && input.isActive,
  };
}

export const DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT: OrganizationAdminActionResult = {
  status: 'idle',
  message: '',
};
