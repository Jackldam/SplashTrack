import test from 'node:test';
import assert from 'node:assert/strict';

import { APP_ROLES, CAPABILITIES, collectCapabilities, hasRequiredAccess } from './authz-core';

test('collectCapabilities maps roles and delegated overrides to expected capabilities', () => {
  assert.ok(collectCapabilities(APP_ROLES.OWNER).includes(CAPABILITIES.organizationSuborgManage));
  assert.ok(collectCapabilities(APP_ROLES.OWNER).includes(CAPABILITIES.organizationOwner));
  assert.deepEqual(collectCapabilities(APP_ROLES.MEMBER), [
    CAPABILITIES.dashboardAccess,
    CAPABILITIES.studentsRead,
    CAPABILITIES.groupsRead,
  ]);
  assert.deepEqual(collectCapabilities(null), []);
  assert.ok(
    collectCapabilities(APP_ROLES.ADMIN, [CAPABILITIES.organizationSuborgManage]).includes(
      CAPABILITIES.organizationSuborgManage,
    ),
  );
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
  assert.equal(
    hasRequiredAccess(adminContext, { capability: CAPABILITIES.organizationSuborgManage }),
    false,
  );
});
