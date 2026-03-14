import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_ROLES } from './authz-core';
import {
  ORGANIZATION_ADMIN_ACTIONS,
  canManageMembershipRoles,
  isOrganizationMembershipMutationAction,
  resolveMembershipActionAvailability,
  validateRoleMutationPolicy,
} from './organization-admin-action-core';

test('membership mutation actions are explicitly limited to activate/deactivate/role update', () => {
  assert.equal(
    isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.activateMembership),
    true,
  );
  assert.equal(
    isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.deactivateMembership),
    true,
  );
  assert.equal(
    isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.updateMembershipRole),
    true,
  );
  assert.equal(isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.viewRole), false);
  assert.equal(isOrganizationMembershipMutationAction('unexpected.action'), false);
});

test('only owners can manage membership roles', () => {
  assert.equal(canManageMembershipRoles(APP_ROLES.OWNER), true);
  assert.equal(canManageMembershipRoles(APP_ROLES.ADMIN), false);
  assert.equal(canManageMembershipRoles(APP_ROLES.MEMBER), false);
});

test('membership action availability keeps self-deactivation blocked and role management owner-only', () => {
  assert.deepEqual(
    resolveMembershipActionAvailability({
      isActive: true,
      isCurrentMembership: false,
      currentUserRole: APP_ROLES.OWNER,
      targetRole: APP_ROLES.ADMIN,
    }),
    {
      canActivate: false,
      canDeactivate: true,
      canManageRoles: true,
    },
  );

  assert.deepEqual(
    resolveMembershipActionAvailability({
      isActive: false,
      isCurrentMembership: false,
      currentUserRole: APP_ROLES.OWNER,
      targetRole: APP_ROLES.MEMBER,
    }),
    {
      canActivate: true,
      canDeactivate: false,
      canManageRoles: false,
    },
  );

  assert.deepEqual(
    resolveMembershipActionAvailability({
      isActive: true,
      isCurrentMembership: true,
      currentUserRole: APP_ROLES.OWNER,
      targetRole: APP_ROLES.OWNER,
    }),
    {
      canActivate: false,
      canDeactivate: false,
      canManageRoles: false,
    },
  );

  assert.deepEqual(
    resolveMembershipActionAvailability({
      isActive: true,
      isCurrentMembership: false,
      currentUserRole: APP_ROLES.ADMIN,
      targetRole: APP_ROLES.MEMBER,
    }),
    {
      canActivate: false,
      canDeactivate: true,
      canManageRoles: false,
    },
  );
});

test('role mutation policy blocks unsafe owner mutations', () => {
  assert.deepEqual(
    validateRoleMutationPolicy({
      actorRole: APP_ROLES.ADMIN,
      actorMembershipId: 'membership-admin',
      targetMembershipId: 'membership-member',
      currentRole: APP_ROLES.MEMBER,
      nextRole: APP_ROLES.ADMIN,
      activeOwnerCount: 1,
    }),
    {
      allowed: false,
      message: 'Alleen owners mogen membership-rollen wijzigen.',
    },
  );

  assert.deepEqual(
    validateRoleMutationPolicy({
      actorRole: APP_ROLES.OWNER,
      actorMembershipId: 'membership-owner',
      targetMembershipId: 'membership-owner',
      currentRole: APP_ROLES.OWNER,
      nextRole: APP_ROLES.ADMIN,
      activeOwnerCount: 2,
    }),
    {
      allowed: false,
      message: 'Je kunt je eigen membership-rol niet wijzigen.',
    },
  );

  assert.deepEqual(
    validateRoleMutationPolicy({
      actorRole: APP_ROLES.OWNER,
      actorMembershipId: 'membership-owner-1',
      targetMembershipId: 'membership-owner-2',
      currentRole: APP_ROLES.OWNER,
      nextRole: APP_ROLES.ADMIN,
      activeOwnerCount: 1,
    }),
    {
      allowed: false,
      message: 'De laatste actieve owner kan niet worden gedegradeerd.',
    },
  );

  assert.deepEqual(
    validateRoleMutationPolicy({
      actorRole: APP_ROLES.OWNER,
      actorMembershipId: 'membership-owner',
      targetMembershipId: 'membership-admin',
      currentRole: APP_ROLES.ADMIN,
      nextRole: APP_ROLES.MEMBER,
      activeOwnerCount: 2,
    }),
    {
      allowed: true,
    },
  );
});
