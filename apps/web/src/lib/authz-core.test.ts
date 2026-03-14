import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_ROLES, CAPABILITIES, collectCapabilities, hasRequiredAccess } from './authz-core';

test('collectCapabilities maps foundation roles to expected capabilities', () => {
  assert.deepEqual(collectCapabilities(APP_ROLES.OWNER), [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.organizationAdmin,
    CAPABILITIES.organizationOwner,
  ]);
  assert.deepEqual(collectCapabilities(APP_ROLES.ADMIN), [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.organizationAdmin,
  ]);
  assert.deepEqual(collectCapabilities(APP_ROLES.MEMBER), [CAPABILITIES.dashboardAccess]);
  assert.deepEqual(collectCapabilities(null), []);
});

test('hasRequiredAccess enforces both role and capability requirements', () => {
  const adminContext = {
    membership: { role: APP_ROLES.ADMIN },
    capabilities: collectCapabilities(APP_ROLES.ADMIN),
  };

  assert.equal(
    hasRequiredAccess(adminContext, { capability: CAPABILITIES.dashboardAccess }),
    true,
  );
  assert.equal(
    hasRequiredAccess(adminContext, { role: APP_ROLES.ADMIN, capability: CAPABILITIES.organizationAdmin }),
    true,
  );
  assert.equal(
    hasRequiredAccess(adminContext, { role: APP_ROLES.OWNER }),
    false,
  );
  assert.equal(
    hasRequiredAccess(adminContext, { capability: CAPABILITIES.organizationOwner }),
    false,
  );
});
