import { buildStudentIdentityKey, normalizeStudentNamePart } from '@/lib/student-identity';
import type { CreateStudentInput } from '@/lib/student-forms';
import { STUDENT_DELETE_POLICY } from '@/lib/student-policy';

export function isStudentDuplicateConflictError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export function buildStudentDuplicateConflictMessage(input: Pick<CreateStudentInput, 'firstName' | 'lastName' | 'dateOfBirth'>) {
  const identityKey = buildStudentIdentityKey(input);
  const normalizedName = `${normalizeStudentNamePart(input.firstName)} ${normalizeStudentNamePart(input.lastName)}`;

  if (!input.dateOfBirth) {
    return `Er bestaat al een student met dezelfde genormaliseerde naam (${normalizedName}) zonder geboortedatum binnen deze organization. Omdat gedeactiveerde records bewaard blijven, kun je deze student niet nogmaals aanmaken zonder eerst een geboortedatum toe te voegen of het bestaande record te hergebruiken.`;
  }

  const dateOfBirth = input.dateOfBirth.toISOString().slice(0, 10);

  return `Er bestaat al een student met dezelfde naam en geboortedatum (${dateOfBirth}) binnen deze organization. De duplicaatblokkade geldt ook voor gedeactiveerde records zolang ${STUDENT_DELETE_POLICY.archiveMode} het enige ondersteunde lifecycle-pad is. [identityKey: ${identityKey}]`;
}
