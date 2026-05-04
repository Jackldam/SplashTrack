import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_ROLES, CAPABILITIES, collectCapabilities } from '@/rbac/core';
import type { AuthContext } from '@/rbac/index';
import { canAccessOrganizationAdmin } from './admin';

function createContext(role: (typeof APP_ROLES)[keyof typeof APP_ROLES]): AuthContext {
  const organization = {
    id: 'org-1',
    slug: 'demo-org',
    name: 'Demo Org',
    parentOrganizationId: null,
    parentOrganization: null,
  };
  const membership = {
    id: 'membership-1',
    role,
    organization,
  };

  return {
    session: {
      session: {
        id: 'session-1',
        token: 'token',
        userId: 'user-1',
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      user: {
        id: 'user-1',
        email: 'demo@example.com',
        emailVerified: true,
        name: 'Demo',
        createdAt: new Date(),
        updatedAt: new Date(),
        image: null,
        isActive: true,
      },
    },
    membership,
    currentMembership: membership,
    activeOrganization: organization,
    allMemberships: [membership],
    capabilities: collectCapabilities(role),
    isHeadOrganization: true,
    childOrganizations: [],
  };
}

test('organization admin access is limited to owner/admin capabilities', () => {
  assert.equal(canAccessOrganizationAdmin(createContext(APP_ROLES.OWNER)), true);
  assert.equal(canAccessOrganizationAdmin(createContext(APP_ROLES.ADMIN)), true);
  assert.equal(canAccessOrganizationAdmin(createContext(APP_ROLES.MEMBER)), false);

  const noMembershipContext: AuthContext = {
    ...createContext(APP_ROLES.ADMIN),
    membership: null,
    currentMembership: null,
    activeOrganization: null,
    allMemberships: [],
    isHeadOrganization: false,
    capabilities: [CAPABILITIES.dashboardAccess],
  };

  assert.equal(canAccessOrganizationAdmin(noMembershipContext), false);
});
