import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSkillName,
  parseCreateSkillFormData,
  parseUpdateSkillFormData,
} from './skill-forms.js';

describe('normalizeSkillName', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(normalizeSkillName('  Borstcrawl  basis  '), 'Borstcrawl basis');
  });

  it('preserves normal names unchanged', () => {
    assert.equal(normalizeSkillName('Rugslag gevorderd'), 'Rugslag gevorderd');
  });
});

describe('parseCreateSkillFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Borstcrawl', swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Borstcrawl');
      assert.equal(result.data.swimLevel, 'Diploma A');
      assert.equal(result.data.isActive, true);
      assert.equal(result.data.description, undefined);
    }
  });

  it('returns success with optional description', () => {
    const fd = makeFormData({
      name: 'Rugslag',
      swimLevel: 'Diploma B',
      isActive: 'false',
      description: 'Op de rug zwemmen.',
    });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.description, 'Op de rug zwemmen.');
      assert.equal(result.data.isActive, false);
    }
  });

  it('defaults isActive to true when not provided', () => {
    const fd = makeFormData({ name: 'Schoolslag', swimLevel: 'Diploma A' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.isActive, true);
    }
  });

  it('returns error for missing name', () => {
    const fd = makeFormData({ swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for missing swimLevel', () => {
    const fd = makeFormData({ name: 'Borstcrawl', isActive: 'true' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for name exceeding max length', () => {
    const fd = makeFormData({ name: 'A'.repeat(121), swimLevel: 'Diploma A', isActive: 'true' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, false);
  });

  it('normalizes whitespace in name', () => {
    const fd = makeFormData({ name: '  Rugslag   gevorderd  ', swimLevel: 'Diploma B', isActive: 'false' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Rugslag gevorderd');
      assert.equal(result.data.isActive, false);
    }
  });

  it('treats empty description as undefined', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: 'Diploma A', isActive: 'true', description: '   ' });
    const result = parseCreateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.description, undefined);
    }
  });
});

describe('parseUpdateSkillFormData', () => {
  function makeFormData(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      fd.set(key, value);
    }
    return fd;
  }

  it('returns success with valid data', () => {
    const fd = makeFormData({ name: 'Schoolslag', swimLevel: 'Diploma B', isActive: 'false' });
    const result = parseUpdateSkillFormData(fd);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Schoolslag');
      assert.equal(result.data.isActive, false);
    }
  });

  it('returns error for empty name', () => {
    const fd = makeFormData({ name: '', swimLevel: 'Diploma B', isActive: 'true' });
    const result = parseUpdateSkillFormData(fd);
    assert.equal(result.success, false);
  });

  it('returns error for empty swimLevel', () => {
    const fd = makeFormData({ name: 'Test', swimLevel: '', isActive: 'true' });
    const result = parseUpdateSkillFormData(fd);
    assert.equal(result.success, false);
  });
});
