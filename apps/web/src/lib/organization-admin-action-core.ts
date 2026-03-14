export const ORGANIZATION_ADMIN_ACTIONS = {
  activateMembership: 'membership.activate',
  deactivateMembership: 'membership.deactivate',
  viewRole: 'membership.view-role',
} as const;

export type OrganizationAdminActionId =
  (typeof ORGANIZATION_ADMIN_ACTIONS)[keyof typeof ORGANIZATION_ADMIN_ACTIONS];

export type OrganizationAdminActionResult = {
  status: 'idle' | 'success' | 'error';
  message: string;
};

export function isOrganizationMembershipMutationAction(
  action: string,
): action is 'membership.activate' | 'membership.deactivate' {
  return (
    action === ORGANIZATION_ADMIN_ACTIONS.activateMembership ||
    action === ORGANIZATION_ADMIN_ACTIONS.deactivateMembership
  );
}

export function resolveMembershipActionAvailability(input: {
  isActive: boolean;
  isCurrentMembership: boolean;
}) {
  return {
    canActivate: !input.isActive,
    canDeactivate: input.isActive && !input.isCurrentMembership,
  };
}

export const DEFAULT_ORGANIZATION_ADMIN_ACTION_RESULT: OrganizationAdminActionResult = {
  status: 'idle',
  message: '',
};
