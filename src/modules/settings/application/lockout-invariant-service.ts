/**
 * D-141's lockout invariant, backed by the database.
 *
 * The one exported entry point every caller uses is
 * {@link assertLockoutInvariantHolds}: it counts, decides, and throws
 * {@link LockoutInvariantViolationError} when the invariant would not hold —
 * refusing the settings write, the role revocation or the account disable
 * that called it. See `../domain/lockout-invariant.ts` for the predicate this
 * adapts, and its header for the two call sites D-141 names (a settings write
 * in the `Authentication`/`Security` category, and every role revocation /
 * account disable — the latter not built in this phase, flagged in the report).
 *
 * EXCLUSIONS ARE HOW A HYPOTHETICAL ACTION IS CHECKED BEFORE IT HAPPENS. A
 * role revocation calls this with the grant it is ABOUT to delete already
 * excluded from the count; an account disable, with the account already
 * excluded. A settings write passes no exclusions at all — D-141's own words
 * are "checked against the database at write time, not against the values
 * being written", so an Authentication/Security write is refused exactly when
 * the invariant ALREADY does not hold, regardless of what the write itself
 * contains.
 */

import type { DatabaseClient } from "@/lib/database";
import { prisma } from "@/lib/database";

import {
  checkLockoutInvariant,
  type LockoutInvariantCheck,
} from "../domain/lockout-invariant";

export interface LockoutInvariantExclusions {
  /** Grants to treat as already gone — the role-revocation call shape. */
  readonly excludeRoleAssignmentIds?: readonly string[];
  /** Accounts to treat as already disabled — the account-disable call shape. */
  readonly excludeAccountIds?: readonly string[];
}

export class LockoutInvariantViolationError extends Error {
  constructor(public readonly check: LockoutInvariantCheck) {
    super(
      "Refused: this action would leave the installation without a local " +
        "ORGANIZATION-scoped account holding a verified MFA factor (D-141).",
    );
    this.name = "LockoutInvariantViolationError";
  }
}

/**
 * Counts ACTIVE `UserAccount`s whose person holds a live `ORGANIZATION`-scoped
 * `RoleAssignment` AND who hold at least one verified MFA factor (a verified
 * `TwoFactor` enrolment or a registered `Passkey` — D-132).
 */
export async function countQualifyingAccounts(
  db: DatabaseClient,
  exclusions: LockoutInvariantExclusions = {},
  at: Date = new Date(),
): Promise<number> {
  const excludeAccountIds = exclusions.excludeAccountIds ?? [];
  const excludeRoleAssignmentIds = exclusions.excludeRoleAssignmentIds ?? [];

  const accounts = await db.userAccount.findMany({
    where: {
      status: "ACTIVE",
      ...(excludeAccountIds.length > 0
        ? { id: { notIn: [...excludeAccountIds] } }
        : {}),
      person: {
        roleAssignments: {
          some: {
            scopeType: "ORGANIZATION",
            validFrom: { lte: at },
            OR: [{ validUntil: null }, { validUntil: { gt: at } }],
            ...(excludeRoleAssignmentIds.length > 0
              ? { id: { notIn: [...excludeRoleAssignmentIds] } }
              : {}),
          },
        },
      },
    },
    select: {
      id: true,
      twoFactors: { where: { verified: true }, select: { id: true }, take: 1 },
      passkeys: { select: { id: true }, take: 1 },
    },
  });

  return accounts.filter(
    (account) => account.twoFactors.length > 0 || account.passkeys.length > 0,
  ).length;
}

/** The check, without throwing — used by the diagnostics page. */
export async function evaluateLockoutInvariant(
  db: DatabaseClient = prisma,
  exclusions: LockoutInvariantExclusions = {},
  at: Date = new Date(),
): Promise<LockoutInvariantCheck> {
  const qualifyingAccounts = await countQualifyingAccounts(db, exclusions, at);
  return checkLockoutInvariant({ qualifyingAccounts });
}

/**
 * Refuses (throws {@link LockoutInvariantViolationError}) when the invariant
 * would not hold. Every settings write in the `Authentication`/`Security`
 * category calls this with no exclusions; a future role-revocation / account-
 * disable operation calls it with the pending change excluded.
 */
export async function assertLockoutInvariantHolds(
  db: DatabaseClient = prisma,
  exclusions: LockoutInvariantExclusions = {},
  at: Date = new Date(),
): Promise<LockoutInvariantCheck> {
  const check = await evaluateLockoutInvariant(db, exclusions, at);
  if (!check.holds) {
    throw new LockoutInvariantViolationError(check);
  }
  return check;
}
