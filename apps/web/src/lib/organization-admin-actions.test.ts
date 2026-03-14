import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANIZATION_ADMIN_ACTIONS,
  isOrganizationMembershipMutationAction,
  resolveMembershipActionAvailability,
} from './organization-admin-action-core';

test('membership mutation actions are explicitly limited to activate/deactivate', () => {
  assert.equal(
    isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.activateMembership),
    true,
  );
  assert.equal(
    isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.deactivateMembership),
    true,
  );
  assert.equal(isOrganizationMembershipMutationAction(ORGANIZATION_ADMIN_ACTIONS.viewRole), false);
  assert.equal(isOrganizationMembershipMutationAction('unexpected.action'), false);
});

test('membership action availability keeps self-deactivation blocked', () => {
  assert.deepEqual(
    resolveMembershipActionAvailability({ isActive: true, isCurrentMembership: false }),
    {
      canActivate: false,
      canDeactivate: true,
    },
  );

  assert.deepEqual(
    resolveMembershipActionAvailability({ isActive: false, isCurrentMembership: false }),
    {
      canActivate: true,
      canDeactivate: false,
    },
  );

  assert.deepEqual(
    resolveMembershipActionAvailability({ isActive: true, isCurrentMembership: true }),
    {
      canActivate: false,
      canDeactivate: false,
    },
  );
});
