/**
 * Member numbers and pupil numbers — *lidnummer* and *leerlingnummer*.
 *
 * TWO SEPARATE NUMBERING SPACES, which is D-053's "different numbering" made
 * literal: a person who is both a member and a pupil carries two numbers,
 * because the club's member register and its lesson administration are two
 * registers with two lifecycles. Folding them would be the single-table-with-a-
 * flag mistake wearing a different hat.
 *
 * ADMINISTRATOR-SUPPLIED FIRST, ALLOCATED SECOND. Clubs arrive with an existing
 * numbering scheme — prefixes, letters, leading zeros — and D-157's bulk import
 * has to preserve it exactly. So the number is a STRING the administrator may
 * type, and only a blank one is allocated. That is also why neither column is an
 * integer: `0042` and `42` are the same integer and two different member
 * numbers.
 */

/**
 * What a supplied number may look like. Deliberately permissive — this is a
 * bound on abuse, not a house style, and refusing a club's own real number
 * because it has a slash in it would make the import unusable.
 */
export const NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;

/** The prefix allocated numbers carry, per register. */
export const MEMBER_NUMBER_PREFIX = "M-";
export const STUDENT_NUMBER_PREFIX = "L-";

/** How many digits an allocated number is padded to. */
const ALLOCATED_DIGITS = 5;

export class InvalidNumberError extends Error {
  constructor(
    public readonly field: string,
    value: string,
  ) {
    super(
      `"${value}" is not a usable ${field}. It must be 1-32 characters of ` +
        "letters, digits, dot, underscore, slash or hyphen, starting with a " +
        "letter or a digit.",
    );
    this.name = "InvalidNumberError";
  }
}

/** Trims and validates an administrator-supplied number, or throws. */
export function normaliseSuppliedNumber(field: string, value: string): string {
  const trimmed = value.trim();
  if (!NUMBER_PATTERN.test(trimmed)) throw new InvalidNumberError(field, value);
  return trimmed;
}

/**
 * The next allocated number after `existing`, given a prefix.
 *
 * PURE, and takes the existing numbers rather than reading them, so the rule is
 * testable without a database and the caller owns the transaction the read and
 * the write share.
 *
 * It only ever looks at numbers that MATCH THE PREFIX SHAPE. A club's own
 * legacy numbers (`1998-17`, `ZK042`) are ignored rather than parsed, because
 * guessing a successor for a scheme we did not invent produces collisions —
 * and the unique index is what catches the case where a club's scheme happens
 * to collide with ours anyway.
 */
export function nextAllocatedNumber(
  prefix: string,
  existing: readonly string[],
): string {
  const shape = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
  let highest = 0;
  for (const value of existing) {
    const match = shape.exec(value);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return `${prefix}${String(highest + 1).padStart(ALLOCATED_DIGITS, "0")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
