/**
 * D-141's lockout invariant, as a pure predicate.
 *
 * `02-security-privacy.md` §1.2.1 (D-141) and `13-configuration-and-setup.md`
 * §3.2/§7 state the same rule: **at least one local `ORGANIZATION`-scoped
 * account with a verified MFA factor must exist at all times.** It is
 * "database-level" — checked against what currently exists, not against any
 * value being written — and re-evaluated on:
 *
 *   1. every write to a setting in the `Authentication` or `Security` category
 *      (`@/modules/settings`'s `application/settings-service.ts`);
 *   2. every role revocation and every account disable — NOT BUILT in this
 *      phase (there is no People & roles module yet to revoke a role from or
 *      disable an account in), but exported here, under one name, so the
 *      module that adds those operations calls this and does not reinvent the
 *      check. See the phase report for this flagged gap.
 *
 * WHY THIS FILE IS PURE. The predicate takes a plain summary of what the
 * database currently holds, not a Prisma client — the same shape
 * `@/lib/boot/state.ts` uses for its own predicates, and for the same reason:
 * a rule this security-critical is worth testing against fabricated inputs
 * covering every branch, not only against a live database. The DB-backed
 * caller (`../application/lockout-invariant-service.ts`) is a thin adapter
 * that counts rows and calls this.
 *
 * "Local" means a `UserAccount` reachable by password/passkey/TOTP sign-in —
 * this application has no SSO/identity-provider implementation in v1 (D-106
 * marks it "requires a spike before being treated as decided"), so every
 * account today IS local by construction. The predicate still names the
 * concept explicitly rather than assuming it, so the day an identity provider
 * ships, only the counting adapter needs to learn to exclude SSO-only
 * accounts — this file does not change.
 *
 * "Verified MFA factor" is a verified TOTP enrolment (`TwoFactor.verified`) OR
 * a registered WebAuthn passkey (`Passkey` — D-132: a passkey alone is a
 * strong second factor for the poolside "wet hands" case this application is
 * built for).
 */

/** What the caller must count before asking the question. */
export interface LockoutInvariantCounts {
  /**
   * Local `ORGANIZATION`-scoped accounts (an ACTIVE `UserAccount`, its
   * `Person` holding a live `RoleAssignment` at `scopeType: "ORGANIZATION"`)
   * that ALSO hold at least one verified MFA factor.
   *
   * The caller is responsible for excluding the specific account/grant a
   * hypothetical action would remove — see
   * {@link holdsAfterRevocation} for the role-revocation / account-disable
   * shape, where the count is computed AS IF the action had already happened.
   */
  readonly qualifyingAccounts: number;
}

/**
 * Does the invariant hold? One question: is there still at least one
 * qualifying account?
 */
export function lockoutInvariantHolds(counts: LockoutInvariantCounts): boolean {
  return counts.qualifyingAccounts >= 1;
}

/**
 * The two REASONS a settings write in the `Authentication`/`Security`
 * category is refused: the invariant already does not hold (a pre-existing
 * bad state this write must not be allowed to compound), or holds only via
 * one account (recorded for the audit event / diagnostics, not itself a
 * refusal reason — one qualifying account is a valid, if fragile, state).
 */
export interface LockoutInvariantCheck {
  readonly holds: boolean;
  readonly qualifyingAccounts: number;
}

export function checkLockoutInvariant(
  counts: LockoutInvariantCounts,
): LockoutInvariantCheck {
  return {
    holds: lockoutInvariantHolds(counts),
    qualifyingAccounts: counts.qualifyingAccounts,
  };
}
