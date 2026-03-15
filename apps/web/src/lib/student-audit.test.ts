import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStudentAuditActivityItem } from './student-audit';

test('buildStudentAuditActivityItem summarizes student update diffs', () => {
  const item = buildStudentAuditActivityItem({
    id: 'audit_1',
    action: 'student.updated',
    createdAt: new Date('2026-03-15T09:00:00.000Z'),
    actorType: 'USER',
    actorUser: {
      id: 'user_1',
      name: 'Admin User',
      email: 'admin@example.com',
    },
    metadata: {
      previousStudent: {
        firstName: 'Sara',
        lastName: 'Jansen',
        dateOfBirth: '2016-04-10T00:00:00.000Z',
        swimLevel: 'Bad 1',
        isActive: true,
      },
      updatedStudent: {
        firstName: 'Sara',
        lastName: 'Jansen',
        dateOfBirth: '2016-04-10T00:00:00.000Z',
        swimLevel: 'Bad 2',
        isActive: false,
      },
    },
  });

  assert.equal(item.actionLabel, 'Bijgewerkt');
  assert.equal(item.actorLabel, 'admin@example.com');
  assert.deepEqual(item.changes, [
    {
      label: 'Niveau',
      value: 'Bad 1 → Bad 2',
    },
    {
      label: 'Status actief',
      value: 'Ja → Nee',
    },
  ]);
});

test('buildStudentAuditActivityItem summarizes lifecycle changes', () => {
  const item = buildStudentAuditActivityItem({
    id: 'audit_2',
    action: 'student.deactivated',
    createdAt: new Date('2026-03-15T09:30:00.000Z'),
    actorType: 'USER',
    actorUser: null,
    metadata: {
      previousIsActive: true,
      nextIsActive: false,
    },
  });

  assert.equal(item.actionLabel, 'Gedeactiveerd');
  assert.equal(item.actorLabel, 'USER');
  assert.deepEqual(item.changes, [
    {
      label: 'Status',
      value: 'Actief → Inactief',
    },
  ]);
});
