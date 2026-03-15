import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCreateStudentInput, parseCreateStudentFormData } from './student-forms';

test('normalizeCreateStudentInput trims values, collapses whitespace and maps booleans/dates', () => {
  const result = normalizeCreateStudentInput({
    firstName: '  Saar   ',
    lastName: ' de   Vries ',
    dateOfBirth: '2018-02-14',
    swimLevel: ' Diploma A ',
    isActive: 'false',
  });

  assert.equal(result.firstName, 'Saar');
  assert.equal(result.lastName, 'de Vries');
  assert.equal(result.swimLevel, 'Diploma A');
  assert.equal(result.isActive, false);
  assert.equal(result.dateOfBirth?.toISOString(), '2018-02-14T00:00:00.000Z');
});

test('parseCreateStudentFormData returns validation error for empty required fields', () => {
  const formData = new FormData();
  formData.set('firstName', '');
  formData.set('lastName', '');
  formData.set('swimLevel', '');

  const result = parseCreateStudentFormData(formData);

  assert.equal(result.success, false);
  assert.equal(result.message, 'Voornaam is verplicht.');
});

test('parseCreateStudentFormData parses valid payload', () => {
  const formData = new FormData();
  formData.set('firstName', 'Milan');
  formData.set('lastName', 'Jansen');
  formData.set('dateOfBirth', '2017-06-03');
  formData.set('swimLevel', 'Diploma A');
  formData.set('isActive', 'true');

  const result = parseCreateStudentFormData(formData);

  assert.equal(result.success, true);

  if (result.success) {
    assert.equal(result.data.firstName, 'Milan');
    assert.equal(result.data.lastName, 'Jansen');
    assert.equal(result.data.swimLevel, 'Diploma A');
    assert.equal(result.data.isActive, true);
    assert.equal(result.data.dateOfBirth?.toISOString(), '2017-06-03T00:00:00.000Z');
  }
});
