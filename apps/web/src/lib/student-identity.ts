export function normalizeStudentNamePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-NL');
}

export function buildStudentIdentityKey(input: {
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
}): string {
  const firstName = normalizeStudentNamePart(input.firstName);
  const lastName = normalizeStudentNamePart(input.lastName);
  const dateOfBirthKey = input.dateOfBirth ? input.dateOfBirth.toISOString().slice(0, 10) : 'unknown-dob';

  return `${firstName}::${lastName}::${dateOfBirthKey}`;
}
