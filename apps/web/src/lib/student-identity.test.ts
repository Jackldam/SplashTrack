import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStudentIdentityKey, normalizeStudentNamePart } from './student-identity';

test('normalizeStudentNamePart trims, collapses whitespace and lowercases', () => {
  assert.equal(normalizeStudentNamePart('  Saar   van  Dijk '), 'saar van dijk');
});

test('buildStudentIdentityKey includes normalized names and date of birth when available', () => {
  const key = buildStudentIdentityKey({
    firstName: ' Saar ',
    lastName: ' de Vries ',
    dateOfBirth: new Date('2018-02-14T00:00:00.000Z'),
  });

  assert.equal(key, 'saar::de vries::2018-02-14');
});

test('buildStudentIdentityKey falls back to unknown-dob when date of birth is missing', () => {
  const key = buildStudentIdentityKey({
    firstName: 'Milan',
    lastName: 'Jansen',
    dateOfBirth: null,
  });

  assert.equal(key, 'milan::jansen::unknown-dob');
});
