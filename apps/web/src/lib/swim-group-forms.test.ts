import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSwimGroupName,
  parseCreateSwimGroupFormData,
  parseUpdateSwimGroupFormData,
} from './swim-group-forms.js';

describe('normalizeSwimGroupName', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeSwimGroupName('  Beginners  A  '), 'Beginners A');
  });

  it('preserves normal names unchanged', () => {
    assert.equal(normalizeSwimGroupName('Diploma A Groep'), 'Diploma A Groep');
  });
});

describe('parseCreateSwimGroupFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Beginners A', swimLevel: 'Watergewenning', isActive: 'true' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Beginners A');
      assert.equal(result.data.swimLevel, 'Watergewenning');
      assert.equal(result.data.isActive, true);
    }
  });

  it('defaults isActive to true when not provided', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: 'Diploma A' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.isActive, true);
    }
  });

  it('returns error for missing name', () => {
    const fd = makeFormData({ swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for missing swimLevel', () => {
    const fd = makeFormData({ name: 'Test Groep', isActive: 'true' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for name exceeding max length', () => {
    const fd = makeFormData({ name: 'A'.repeat(121), swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, false);
  });

  it('normalizes whitespace in name', () => {
    const fd = makeFormData({ name: '  Groep   A  ', swimLevel: 'Diploma A', isActive: 'false' });
    const result = parseCreateSwimGroupFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Groep A');
      assert.equal(result.data.isActive, false);
    }
  });
});

describe('parseUpdateSwimGroupFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Gevorderden B', swimLevel: 'Diploma B', isActive: 'false' });
    const result = parseUpdateSwimGroupFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Gevorderden B');
      assert.equal(result.data.isActive, false);
    }
  });

  it('returns error for empty name', () => {
    const fd = makeFormData({ name: '', swimLevel: 'Diploma B', isActive: 'true' });
    const result = parseUpdateSwimGroupFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for empty swimLevel', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: '', isActive: 'true' });
    const result = parseUpdateSwimGroupFormData(fd);
    assert.equal(result.success, false);
  });
});
