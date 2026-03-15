import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStudentDuplicateConflictMessage, isStudentDuplicateConflictError } from './student-duplicate-policy';

test('duplicate conflict detection recognizes Prisma P2002 shape', () => {
  assert.equal(isStudentDuplicateConflictError({ code: 'P2002' }), true);
  assert.equal(isStudentDuplicateConflictError({ code: 'OTHER' }), false);
  assert.equal(isStudentDuplicateConflictError(null), false);
});

test('duplicate conflict message explains missing DOB archive semantics', () => {
  const message = buildStudentDuplicateConflictMessage({
    firstName: ' Saar ',
    lastName: ' van  Dijk ',
    dateOfBirth: null,
  });

  assert.match(message, /dezelfde genormaliseerde naam/i);
  assert.match(message, /gedeactiveerde records bewaard blijven/i);
});

test('duplicate conflict message includes date and identity key when DOB is known', () => {
  const message = buildStudentDuplicateConflictMessage({
    firstName: 'Sara',
    lastName: 'Jansen',
    dateOfBirth: new Date('2016-04-10T00:00:00.000Z'),
  });

  assert.match(message, /2016-04-10/);
  assert.match(message, /identityKey: sara::jansen::2016-04-10/);
});
