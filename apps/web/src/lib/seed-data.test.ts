import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_ORGANIZATION,
  DEMO_USERS,
  FOUNDATION_SEED_AUDIT,
} from './seed-data';
import { APP_ROLES } from './authz-core';

test('seed data defines one demo organization and three distinct baseline users', () => {
  assert.equal(DEMO_ORGANIZATION.slug, 'demo-org');
  assert.equal(DEMO_USERS.length, 3);

  const emails = new Set(DEMO_USERS.map((user) => user.email));
  assert.equal(emails.size, DEMO_USERS.length);

  const roles = DEMO_USERS.map((user) => user.role);
  assert.deepEqual(roles, [APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]);
});

test('seed audit metadata stays aligned with seeded users', () => {
  assert.equal(FOUNDATION_SEED_AUDIT.entityId, DEMO_ORGANIZATION.slug);
  assert.deepEqual(
    FOUNDATION_SEED_AUDIT.metadata.seededUsers,
    DEMO_USERS.map(({ email, role }) => ({ email, role })),
  );
  for (const user of DEMO_USERS) {
    assert.ok(user.password.length >= 8);
  }
});
