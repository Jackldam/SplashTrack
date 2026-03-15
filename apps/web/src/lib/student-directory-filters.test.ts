import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStudentDirectoryStatusLabel,
  normalizeStudentDirectorySearch,
  parseStudentDirectoryQuery,
} from './student-directory-filters';

test('parseStudentDirectoryQuery keeps valid status and normalized search', () => {
  assert.deepEqual(
    parseStudentDirectoryQuery({
      status: 'inactive',
      search: '  Sara   de  Vries  ',
    }),
    {
      status: 'inactive',
      search: 'Sara de Vries',
    },
  );
});

test('parseStudentDirectoryQuery falls back to all for invalid status', () => {
  assert.deepEqual(
    parseStudentDirectoryQuery({
      status: 'archived',
      search: '  Milan  ',
    }),
    {
      status: 'all',
      search: 'Milan',
    },
  );
});

test('normalizeStudentDirectorySearch removes empty values and caps length', () => {
  assert.equal(normalizeStudentDirectorySearch('   '), undefined);
  assert.equal(normalizeStudentDirectorySearch('a'.repeat(200)), 'a'.repeat(120));
});

test('buildStudentDirectoryStatusLabel returns Dutch labels for tabs and summaries', () => {
  assert.equal(buildStudentDirectoryStatusLabel('all'), 'Alle statussen');
  assert.equal(buildStudentDirectoryStatusLabel('active'), 'Actief');
  assert.equal(buildStudentDirectoryStatusLabel('inactive'), 'Inactief');
});
