import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCourseName,
  parseCreateCourseFormData,
  parseUpdateCourseFormData,
} from './course-forms.js';

describe('normalizeCourseName', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeCourseName('  Zwemmen  voor  beginners  '), 'Zwemmen voor beginners');
  });

  it('preserves normal names unchanged', () => {
    assert.equal(normalizeCourseName('Diploma A Cursus'), 'Diploma A Cursus');
  });
});

describe('parseCreateCourseFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Diploma A Cursus', swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Diploma A Cursus');
      assert.equal(result.data.swimLevel, 'Diploma A');
      assert.equal(result.data.isActive, true);
      assert.equal(result.data.description, undefined);
    }
  });

  it('returns success with optional description', () => {
    const fd = makeFormData({
      name: 'Gevorderden B',
      swimLevel: 'Diploma B',
      isActive: 'false',
      description: 'Cursus voor gevorderde zwemmers.',
    });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.description, 'Cursus voor gevorderde zwemmers.');
      assert.equal(result.data.isActive, false);
    }
  });

  it('defaults isActive to true when not provided', () => {
    const fd = makeFormData({ name: 'Test cursus', swimLevel: 'Diploma A' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.isActive, true);
    }
  });

  it('returns error for missing name', () => {
    const fd = makeFormData({ swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for missing swimLevel', () => {
    const fd = makeFormData({ name: 'Test cursus', isActive: 'true' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for name exceeding max length', () => {
    const fd = makeFormData({ name: 'A'.repeat(121), swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, false);
  });

  it('normalizes whitespace in name', () => {
    const fd = makeFormData({ name: '  Diploma   B  cursus  ', swimLevel: 'Diploma B', isActive: 'false' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Diploma B cursus');
      assert.equal(result.data.isActive, false);
    }
  });

  it('treats empty description as undefined', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: 'Diploma A', isActive: 'true', description: '   ' });
    const result = parseCreateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.description, undefined);
    }
  });
});

describe('parseUpdateCourseFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Gevorderden B', swimLevel: 'Diploma B', isActive: 'false' });
    const result = parseUpdateCourseFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Gevorderden B');
      assert.equal(result.data.isActive, false);
    }
  });

  it('returns error for empty name', () => {
    const fd = makeFormData({ name: '', swimLevel: 'Diploma B', isActive: 'true' });
    const result = parseUpdateCourseFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for empty swimLevel', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: '', isActive: 'true' });
    const result = parseUpdateCourseFormData(fd);
    assert.equal(result.success, false);
  });
});
