import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveStudentLifecycleAction,
  resolveStudentLifecycleCopy,
} from './student-lifecycle';

test('student lifecycle action resolves to deactivate for active students', () => {
  assert.equal(resolveStudentLifecycleAction(true), 'student.deactivate');

  assert.deepEqual(resolveStudentLifecycleCopy(true), {
    action: 'student.deactivate',
    buttonLabel: 'Student deactiveren',
    pendingLabel: 'Student deactiveren...',
    helperText:
      'De student blijft bewaard in de directory en audit-log, maar telt niet meer mee als actief. Duplicaatcontrole blijft ook na deactivatie gelden.',
    successMessage: 'Student is gedeactiveerd.',
    auditAction: 'student.deactivated',
    nextIsActive: false,
  });
});

test('student lifecycle action resolves to activate for inactive students', () => {
  assert.equal(resolveStudentLifecycleAction(false), 'student.activate');

  assert.deepEqual(resolveStudentLifecycleCopy(false), {
    action: 'student.activate',
    buttonLabel: 'Student heractiveren',
    pendingLabel: 'Student heractiveren...',
    helperText: 'De student wordt opnieuw actief en telt weer mee in overzichten en level spread.',
    successMessage: 'Student is opnieuw geactiveerd.',
    auditAction: 'student.activated',
    nextIsActive: true,
  });
});
