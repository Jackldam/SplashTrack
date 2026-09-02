/**
 * Server-side session helper (Architecture.md Sections 9, 10; ADR-003).
 *
 * This is the single, typed entry point other server code (Route Handlers,
 * Server Components, Server Actions) uses to answer "who is the current user?".
 * It resolves the Better Auth session and joins it back to the application
 * identity model (Section 8): the `UserAccount` and its linked `Person`.
 *
 * IMPORTANT — this proves IDENTITY only, not AUTHORIZATION (Critical Rule 5).
 * It deliberately does NOT check organization scope, membership, roles or
 * permissions. It returns exactly enough for the upcoming authorization-
 * framework story to build those checks on top: the UserAccount id, the linked
 * Person id, and the org-scoped lookups (OrganizationMembership / RoleAssignment)
 * are keyed by `personId`. Do not add permission logic here.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  prisma,
  UserAccountStatus,
  type SessionMfaEvidence,
} from "@/lib/database";
import { logger } from "@/lib/logging";
import {
  getConfiguredSecurityPolicy,
  SESSION_TIMEOUT_MINUTES,
} from "@/lib/settings";
import { auth } from "./auth";

/**
 * Absolute session cap (Section 9.2): a session may not be renewed beyond this
 * age regardless of activity. Better Auth's sliding `expiresIn` provides the
 * 30-minute IDLE timeout; this provides the ABSOLUTE timeout, enforced here
 * because Better Auth has no built-in absolute cap.
 *
 * The enforced value is now ADMIN-CONFIGURABLE (Settings → Security), read via
 * `getConfiguredSecurityPolicy()` — a per-request-cached, fail-safe-to-default
 * query (a DB blip degrades to this same default, never to "no cap"). This
 * constant remains the DEFAULT/fallback value (720 min = 12h, the platform's
 * original baseline) — it is what an install with no configured policy yet
 * uses, and what a read error falls back to.
 */
export const SESSION_ABSOLUTE_TIMEOUT_SECONDS =
  SESSION_TIMEOUT_MINUTES.default * 60;

/** The current UserAccount (identity + application account state only). */
export interface CurrentUserAccount {
  /** UserAccount id — the subject id Better Auth issues sessions for. */
  id: string;
  email: string;
  status: UserAccountStatus;
  /** FK to the Person this account belongs to (Section 8). */
  personId: string;
}

/** The Person (human / PII anchor) linked to the current account. */
export interface CurrentPerson {
  id: string;
  givenName: string;
  familyName: string;
}

/**
 * The resolved current session. `personId` is the key downstream authorization
 * uses to load OrganizationMembership / RoleAssignment for this user.
 */
export interface CurrentSession {
  sessionId: string;
  expiresAt: Date;
  userAccount: CurrentUserAccount;
  person: CurrentPerson;
  /**
   * Was a second factor proven for THIS session (`Session.mfaEvidence`,
   * security review 2026-08-04 — closing the Entra/Microsoft app-TOTP-bypass
   * gap `documentation/security.md` documents)? `null` means NOT proven —
   * same fail-toward-strict convention as `requiresMfaEnrollment`. Consumed by
   * `requiresMfaStepUp` (Identity module) alongside `twoFactorEnabled`
   * (`getMyAuthMethods`, ACCOUNT-scoped) to decide whether the admin/org area
   * gates must send the caller through a step-up verify before continuing.
   *
   * OPTIONAL on the type (not just nullable) purely so the many hand-built
   * `CurrentSession` test fixtures across the suite that predate this field
   * keep compiling without every one of them being touched — every REAL
   * session this module returns always sets it (to a value or explicit
   * `null`), never leaves it `undefined`. Treat `undefined` the same as
   * `null` (not proven) at every call site.
   */
  mfaEvidence?: SessionMfaEvidence | null;
}

/**
 * Bounds how often {@link getCurrentSession} persists its own `lastSeenAt`
 * activity column for one session, given the currently configured idle
 * window. A real per-request write would put a DB write on nearly every
 * authenticated request (this helper runs on almost every Server Component /
 * Server Action) purely for bookkeeping precision nobody needs — so writes
 * are throttled, the same idea as Better Auth's own `updatedAt` refresh
 * cadence (`SESSION_REFRESH_AGE_SECONDS` in ./auth.ts).
 *
 * Throttling the WRITE (rather than the read) is safe in the direction that
 * matters: the stored value can only ever LAG the true last-activity instant,
 * never run ahead of it — so the idle check can only ever perceive a session
 * as MORE idle than it really is (rejecting it up to `throttleSeconds` too
 * early in the worst case), never LESS idle. That is the opposite failure
 * mode from the bug this replaces, where Better Auth's own refresh made an
 * arbitrarily-stale session look perfectly fresh.
 *
 * The bound is at most 1/4 of the configured idle window (floor 1s, cap
 * 60s): a flat 60s throttle would, at the shortest configurable idle window
 * (`SESSION_IDLE_TIMEOUT_MINUTES.min` = 1 minute), falsely idle-time-out a
 * genuinely active caller making requests every 20-30s purely from write lag.
 * Scaling down for short windows keeps that worst case to a bounded fraction
 * of whatever window is configured, while still capping writes at once a
 * minute for the common (30 min default, or longer) case.
 */
function idleWriteThrottleSeconds(sessionIdleTimeoutMinutes: number): number {
  const quarterOfWindow = Math.floor((sessionIdleTimeoutMinutes * 60) / 4);
  return Math.max(1, Math.min(60, quarterOfWindow));
}

/**
 * Returns the current session, or `null` if the caller is not authenticated.
 *
 * Rejects (returns null) when:
 *   - there is no valid Better Auth session;
 *   - the session has exceeded the ADMIN-CONFIGURED absolute timeout
 *     (Section 9.2) — read via the settings module, cached per-request and
 *     falling back to the default on any error, so this check is always live
 *     without ever hard-failing the auth path;
 *   - the session has exceeded the ADMIN-CONFIGURED IDLE timeout
 *     (FD-AUTHN-30e) — a SECOND, INDEPENDENT check from the app-owned
 *     `Session.lastSeenAt` column (see the long comment inline below for why
 *     `session.updatedAt` cannot be used for this — security review
 *     2026-08-03 found it made the idle check unenforceable), first-to-fail
 *     wins against the absolute timeout. This is enforced HERE rather than
 *     relying on Better Auth's own `expiresIn` because that value is fixed at
 *     auth-context construction (see the long comment on
 *     `SESSION_IDLE_TIMEOUT_SECONDS` in ./auth.ts) and can no longer serve as
 *     the LIVE, admin-configurable idle window — it now only backstops this
 *     check as a generous ceiling;
 *   - the linked UserAccount no longer exists or has been DISABLED — so a
 *     session already in flight stops working the moment its account is
 *     disabled, complementing the login-time block in the auth config
 *     (Section 9.2, defense in depth).
 *
 * Like the absolute-timeout check, an idle-timeout rejection does NOT delete
 * the underlying session row — same documented cosmetic-accuracy tradeoff as
 * `./sessions.ts` (a stale row may still briefly appear in the caller's own
 * "active sessions" list, but grants no access on use and is safe to revoke).
 */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;

  const { session } = result;

  const { sessionAbsoluteTimeoutMinutes, sessionIdleTimeoutMinutes } =
    await getConfiguredSecurityPolicy();

  const ageSeconds =
    (Date.now() - new Date(session.createdAt).getTime()) / 1000;
  if (ageSeconds > sessionAbsoluteTimeoutMinutes * 60) return null;

  // FD-AUTHN-30e / regression fix (security review 2026-08-03, PR #174):
  // idle activity is tracked in our OWN `Session.lastSeenAt` column,
  // deliberately NOT `session.updatedAt` above. Verified against
  // node_modules/better-auth/dist/api/routes/session.mjs: `auth.api.getSession()`
  // itself refreshes `updatedAt` (and `expiresAt`) BEFORE returning, whenever
  // more than `updateAge` (~5 min, see ./auth.ts) has elapsed since the last
  // refresh (`internalAdapter.updateSession(token, { expiresAt, updatedAt })`).
  // So for any real idle gap longer than `updateAge` — i.e. exactly the cases
  // this check exists to catch — `session.updatedAt` had ALREADY been reset
  // to "now" by the very call that fetched it, making a comparison against it
  // here always see an idle age of ~0. That silently undid the enforcement
  // this PR was meant to add — Better Auth's own PREVIOUS fixed 30-minute
  // `expiresIn` had actually enforced idle timeout natively; this replaces
  // that native behaviour with a real one rather than a no-op.
  // `lastSeenAt` is safe from this because Better Auth's adapter does not know
  // the column exists at all (it is not declared in the `session` block of
  // ./auth.ts) — the partial update above touches exactly `expiresAt` /
  // `updatedAt` and nothing else, so it can never be overwritten by Better
  // Auth's own refresh.
  const sessionRow = await prisma.session.findUnique({
    where: { id: session.id },
    select: { lastSeenAt: true, mfaEvidence: true },
  });
  // The row disappeared between `getSession()` resolving it and this read
  // (e.g. revoked concurrently) — nothing valid left to evaluate.
  if (!sessionRow) return null;

  const now = new Date();
  // `lastSeenAt` is null for a session this column predates (rolled out by
  // migration) or that this function has never yet evaluated (brand new).
  // Falling back to Better Auth's `updatedAt` for THIS ONE read — rather than
  // treating null as "never seen" (which would force-expire every
  // pre-existing session the instant this shipped) or as "seen right now"
  // (silently reintroducing the exact bug above) — is safe specifically
  // because it cannot be ridden repeatedly: the write below is UNCONDITIONAL
  // whenever `lastSeenAt` is null, seeding it on this exact call. Every
  // session gets this fallback at most ONCE, ever; every subsequent call is
  // governed entirely by its own tracked column.
  const lastActivity = sessionRow.lastSeenAt ?? new Date(session.updatedAt);
  const idleSeconds = (now.getTime() - lastActivity.getTime()) / 1000;
  if (idleSeconds > sessionIdleTimeoutMinutes * 60) return null;

  // Persist this activity, throttled (see `idleWriteThrottleSeconds` above)
  // so a helper called on nearly every request does not become a DB write on
  // nearly every request — always writes when `lastSeenAt` is still null (the
  // one-time fallback seed just above). Best-effort in BOTH branches below —
  // a write failure here must fail toward REJECTING the session sooner,
  // never granting one, so we never throw — but the two cases differ in
  // whether staying silent about the failure is actually safe (see catch
  // block).
  const throttleSeconds = idleWriteThrottleSeconds(sessionIdleTimeoutMinutes);
  const isNullSeedWrite = sessionRow.lastSeenAt === null;
  const staleForSeconds = sessionRow.lastSeenAt
    ? (now.getTime() - sessionRow.lastSeenAt.getTime()) / 1000
    : Infinity;
  if (staleForSeconds > throttleSeconds) {
    try {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          // `Session.updatedAt` is declared `@updatedAt` in the schema, so
          // Prisma would otherwise auto-bump it on ANY update to this row —
          // including this one — regardless of it not being named in `data`.
          // Pin it back to its already-current value so this throttled
          // bookkeeping write cannot change its refresh cadence, which
          // `./sessions.ts` and `SessionsPanel` document (and test) as
          // Better Auth's own coarse ~5-minute `SESSION_REFRESH_AGE_SECONDS`
          // cadence, not this throttle window.
          updatedAt: session.updatedAt,
        },
      });
    } catch (err) {
      if (isNullSeedWrite) {
        // NOT safe to swallow silently: this is the one-time fallback seed
        // for a session whose `lastSeenAt` is still null (see the long
        // comment above). If this specific write keeps failing, `lastSeenAt`
        // never gets set, so every future call keeps falling back to
        // `session.updatedAt` — the exact timestamp Better Auth resets on
        // its own refresh — silently re-opening the bypass this fix exists
        // to close, indefinitely and with no operational signal otherwise.
        logger.warn(
          {
            event: "auth.session.last_seen_at_seed_failed",
            sessionId: session.id,
            err,
          },
          "Failed to seed Session.lastSeenAt for a null-seed session; the idle " +
            "check will keep falling back to session.updatedAt (the pre-fix " +
            "bypass) until this write succeeds",
        );
      }
      // else: routine throttled refresh of an already-seeded session — a
      // missed write only means the stored value lags slightly, which can
      // only make the idle check reject the session up to `throttleSeconds`
      // too EARLY (see `idleWriteThrottleSeconds`' doc comment), never too
      // late/never-expiring. Silent by design: this helper runs on nearly
      // every request, so logging every transient blip here would be noise,
      // and unlike the null-seed case above there is no way for this
      // failure mode to persist indefinitely without also being caught by
      // the idle check itself.
    }
  }

  // Re-load the account against the live database rather than trusting the
  // session snapshot, so status changes take effect immediately.
  const account = await prisma.userAccount.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      status: true,
      personId: true,
      person: { select: { id: true, givenName: true, familyName: true } },
    },
  });

  // Only an ACTIVE account may hold a session. This rejects a DISABLED account
  // AND a self-registered PENDING_VERIFICATION one (Phase 7b) whose email is
  // not yet verified — defense in depth against a session issued before the
  // status changed.
  if (!account || account.status !== UserAccountStatus.ACTIVE) return null;

  return {
    sessionId: session.id,
    expiresAt: new Date(session.expiresAt),
    userAccount: {
      id: account.id,
      email: account.email,
      status: account.status,
      personId: account.personId,
    },
    person: account.person,
    mfaEvidence: sessionRow.mfaEvidence,
  };
}

/**
 * Like {@link getCurrentSession} but redirects unauthenticated callers to the
 * login page. Use in Server Components / layouts that must not render for
 * anonymous users. Returns a non-null session to the caller.
 */
export async function requireCurrentSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Revokes ALL sessions for a UserAccount by deleting its session rows
 * (Section 9.2 — session invalidation / revocation). Call this when disabling
 * an account or when a user requests "sign out everywhere". Returns the number
 * of sessions revoked.
 */
export async function revokeAllSessionsForUser(
  userAccountId: string,
): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { userId: userAccountId },
  });
  return count;
}
