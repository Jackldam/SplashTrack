import test from 'node:test';
import assert from 'node:assert/strict';

import { DEMO_STUDENTS } from './seed-data';

test('student seed data spans active/inactive records and multiple swim levels', () => {
  assert.equal(DEMO_STUDENTS.length, 4);

  const activeStudents = DEMO_STUDENTS.filter((student) => student.isActive);
  const inactiveStudents = DEMO_STUDENTS.filter((student) => !student.isActive);

  assert.equal(activeStudents.length, 3);
  assert.equal(inactiveStudents.length, 1);

  const swimLevels = new Set(DEMO_STUDENTS.map((student) => student.swimLevel));
  assert.deepEqual([...swimLevels], ['Watergewenning', 'Diploma A', 'Diploma B']);
});
