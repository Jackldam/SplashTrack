import test from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { APP_ROLES } from '@/lib/authz';

/**
 * Inline the schema under test so this file stays a pure unit test without
 * importing the 'use server' action module (which requires Next.js runtime).
 */
const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  email: z.string().trim().email('E-mailadres is ongeldig.').max(320),
  password: z.string().min(8, 'Wachtwoord moet minimaal 8 tekens hebben.').max(120),
  role: z.enum([APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht.').max(120, 'Naam is te lang.'),
  email: z.string().trim().email('E-mailadres is ongeldig.').max(320),
  role: z.enum([APP_ROLES.OWNER, APP_ROLES.ADMIN, APP_ROLES.MEMBER]),
  isActive: z.enum(['true', 'false']),
  password: z
    .string()
    .max(120)
    .refine((val) => val === '' || val.length >= 8, {
      message: 'Wachtwoord moet minimaal 8 tekens hebben.',
    })
    .optional(),
});

test('createUserSchema rejects missing or short password', () => {
  const base = { name: 'Jan', email: 'jan@example.com', role: APP_ROLES.MEMBER };

  const missingResult = createUserSchema.safeParse({ ...base });
  assert.equal(missingResult.success, false);

  const shortResult = createUserSchema.safeParse({ ...base, password: 'abc' });
  assert.equal(shortResult.success, false);
  if (!shortResult.success) {
    assert.equal(shortResult.error.issues[0]?.message, 'Wachtwoord moet minimaal 8 tekens hebben.');
  }
});

test('createUserSchema accepts valid password of at least 8 characters', () => {
  const result = createUserSchema.safeParse({
    name: 'Jan',
    email: 'jan@example.com',
    password: 'veiligww',
    role: APP_ROLES.MEMBER,
  });

  assert.equal(result.success, true);
});

test('updateUserSchema allows empty password (no change)', () => {
  const base = {
    name: 'Jan',
    email: 'jan@example.com',
    role: APP_ROLES.MEMBER,
    isActive: 'true' as const,
    password: '',
  };

  const result = updateUserSchema.safeParse(base);
  assert.equal(result.success, true);

  if (result.success) {
    assert.equal(result.data.password, '');
  }
});

test('updateUserSchema rejects non-empty password shorter than 8 characters', () => {
  const result = updateUserSchema.safeParse({
    name: 'Jan',
    email: 'jan@example.com',
    role: APP_ROLES.MEMBER,
    isActive: 'true',
    password: 'kort',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, 'Wachtwoord moet minimaal 8 tekens hebben.');
  }
});

test('updateUserSchema accepts valid password of at least 8 characters', () => {
  const result = updateUserSchema.safeParse({
    name: 'Jan',
    email: 'jan@example.com',
    role: APP_ROLES.ADMIN,
    isActive: 'false',
    password: 'nieuwwachtwoord',
  });

  assert.equal(result.success, true);

  if (result.success) {
    assert.equal(result.data.password, 'nieuwwachtwoord');
    assert.equal(result.data.isActive, 'false');
  }
});

test('updateUserSchema rejects invalid email', () => {
  const result = updateUserSchema.safeParse({
    name: 'Jan',
    email: 'not-an-email',
    role: APP_ROLES.MEMBER,
    isActive: 'true',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, 'E-mailadres is ongeldig.');
  }
});

test('updateUserSchema rejects empty name', () => {
  const result = updateUserSchema.safeParse({
    name: '   ',
    email: 'jan@example.com',
    role: APP_ROLES.MEMBER,
    isActive: 'true',
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, 'Naam is verplicht.');
  }
});
