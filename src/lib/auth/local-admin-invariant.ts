/**
 * D-141's invariant, as a database question.
 *
 * > *at least one **local** `ORGANIZATION`-scoped account with a **verified**
 * > MFA factor exists at all times, checked at the database and re-evaluated on
 * > every authentication-settings change, role revocation and account disable*
 *
 * WHAT IT REPLACED, AND WHY THAT MATTERS TO THE CODE. The rule this supersedes
 * was *"local administrator login can never be disabled while it is the only
 * working authentication method"*. That is not enforceable, and F-140 is blunt
 * about the failure mode: configure a second identity provider and local login
 * is no longer "the only" method, and "working" is not decidable — a provider
 * that passed a test connection at 14:00 fails at 14:05 on a certificate, a
 * tenant policy or a group membership the application cannot observe. A
 * point-in-time assertion was sold as a continuous invariant. **Do not
 * reintroduce a `testConnection()` gate here and call it a safety net.**
 *
 * EACH WORD IS LOAD-BEARING, so each is checked:
 *
 *   - **local** — a `credential` row in Better Auth's `Account` table with a
 *     non-null password. An account that can only sign in through an external
 *     provider does not satisfy this invariant, because the whole point is
 *     recovery from a broken provider.
 *   - **`ORGANIZATION`-scoped** — a live `RoleAssignment` at `ORGANIZATION`
 *     scope for a role that actually carries `roles.assign`. Binding to a role
 *     NAME would be D-130's mistake: roles are user-definable, so the predicate
 *     has to be a permission.
 *   - **verified MFA factor** — `TwoFactor.verified = true`. Enrolled-but-never-
 *     verified is not a factor: nobody has proved they hold the secret, so
 *     counting it would let the invariant be satisfied by an account that
 *     cannot complete a sign-in.
 *   - **at all times** — hence "live" below: `validFrom <= now` and
 *     (`validUntil` is null or `> now`). A 24-hour break-glass grant
 *     (`admin:grant-admin`) therefore satisfies the invariant while it lasts and
 *     stops satisfying it when it expires, which is the honest reading — it is a
 *     recovery grant, not a standing one.
 *
 * WHEN "AT ALL TIMES" BEGINS (D-185). It begins when SETUP COMPLETES, and this
 * is a restatement rather than a weakening: before `admin:create` runs there is
 * no account at all, so the invariant was never satisfiable on a fresh
 * installation and the register said otherwise. D-185 moves MFA enrolment into
 * the browser, which makes that gap explicit and bounded — between
 * `admin:create` and the administrator verifying a factor there is exactly one
 * account, it is `mfa_pending`, and `@/lib/auth/mfa-enrolment` lets it do two
 * things: sign in, and enrol. The bootstrap record — the thing that ends setup
 * mode — is written by `completeSetupIfInvariantHolds` in `@/lib/boot`, which
 * calls THIS predicate and writes nothing until it returns a non-zero count. So
 * the moment setup completes is by construction the moment the invariant first
 * holds, and it binds continuously from there.
 *
 * The consequence for callers: `admin:create` does NOT call
 * `assertLocalAdminInvariantHolds` — it cannot hold at that point, and
 * asserting it would make the command fail on success. Every other call site is
 * on a post-setup path, where "at all times" means what it says.
 *
 * WHERE IT IS ENFORCED. `13-…` §3.2 places it on the settings write path for
 * the `Authentication` and `Security` categories, and `13-…` §7 adds role
 * revocation and account disable. Two of those three paths do not exist yet —
 * there is no roles module and no account-disable surface in this phase — so
 * what exists today is this predicate plus the settings-write guard, and the
 * two future call sites import `assertLocalAdminInvariantHolds` rather than
 * re-deriving it.
 *
 * SERVER-ONLY.
 */

import { prisma } from "@/lib/database";

/** The permission that decides "administrator" for this invariant (D-130). */
const ADMINISTRATOR_PERMISSION = "roles.assign";

/** Thrown by {@link assertLocalAdminInvariantHolds}. */
export class LocalAdminInvariantError extends Error {
  constructor(action: string) {
    super(
      `${action} would leave this installation with no local ` +
        "ORGANIZATION-scoped administrator holding a verified MFA factor " +
        "(D-141). That is the state from which the only recovery is the " +
        "break-glass CLI on the host, so it is refused. Create or restore a " +
        "second administrator first.",
    );
    this.name = "LocalAdminInvariantError";
  }
}

/**
 * How many accounts satisfy every clause of D-141 right now.
 *
 * `excludeUserAccountId` answers the question a caller actually has — *"would
 * it still hold **after** I do this?"* — without a speculative write: pass the
 * account about to be disabled, or whose factor is about to be reset, and read
 * the count that would remain.
 */
export async function countLocalOrganizationAdmins(
  excludeUserAccountId?: string,
): Promise<number> {
  const now = new Date();

  const rows = await prisma.userAccount.findMany({
    where: {
      status: "ACTIVE",
      ...(excludeUserAccountId ? { id: { not: excludeUserAccountId } } : {}),
      // local: a password credential exists
      accounts: {
        some: { providerId: "credential", password: { not: null } },
      },
      // verified MFA factor
      twoFactors: { some: { verified: true } },
      // ORGANIZATION-scoped grant of a role carrying the administrator
      // permission, live at this instant
      person: {
        roleAssignments: {
          some: {
            scopeType: "ORGANIZATION",
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            role: {
              permissions: {
                some: { permission: { key: ADMINISTRATOR_PERMISSION } },
              },
            },
          },
        },
      },
    },
    select: { id: true },
  });

  return rows.length;
}

/**
 * Refuses an action that would break the invariant. `action` is a short
 * description used in the error message — never a value, never a credential.
 */
export async function assertLocalAdminInvariantHolds(
  action: string,
  excludeUserAccountId?: string,
): Promise<void> {
  const remaining = await countLocalOrganizationAdmins(excludeUserAccountId);
  if (remaining === 0) throw new LocalAdminInvariantError(action);
}
