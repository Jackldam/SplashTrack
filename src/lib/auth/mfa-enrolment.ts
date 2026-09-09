/**
 * `mfa_pending` — an account that exists, holds a password, and has not yet
 * proved a second factor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS STATE EXISTS AT ALL
 *
 * It is the bounded window D-185 opens. `admin:create` used to enrol MFA from
 * the terminal: it wrote the TOTP secret to a `0600` file, printed only the
 * path, and then blocked on a prompt demanding a six-digit code — which the
 * operator could not produce without abandoning the prompt to open the file.
 * The command could not be completed by the person it exists for.
 *
 * The requirement that made it that shape is unchanged and is not weakened
 * here: THE SECRET MUST NEVER REACH A TERMINAL, A LOG OR A SCROLLBACK BUFFER,
 * because F-20 states as a design assumption that self-hosters paste terminal
 * output into public issues. What was wrong was the PLACE. A browser can render
 * a QR code, is where every other product enrols an authenticator, and is not
 * something anybody pastes into a chat. So `admin:create` now creates the
 * account and stops, and enrolment happens on first sign-in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT SUCH AN ACCOUNT MAY DO: SIGN IN, AND ENROL. NOTHING ELSE.
 *
 * An account that can act before its second factor exists is a worse hole than
 * the one this closes — it is an ORGANIZATION-scoped administrator behind one
 * password. So the window is closed from both sides, server-side:
 *
 *   • {@link MFA_PENDING_ALLOWED_AUTH_PATHS} bounds the Better Auth HTTP
 *     surface. `/api/auth/[...all]` mounts EVERY Better Auth endpoint, so a
 *     session cookie held by a pending account would otherwise reach
 *     `update-user`, `change-email`, passkey registration and the rest by a
 *     direct POST, with no application page involved at all.
 *
 *   • `requireEnrolledSession()` in ./session.ts bounds every page and Server
 *     Action. It is the only guard those surfaces use, so a new screen is
 *     covered by construction rather than by remembering.
 *
 * THE PREDICATE IS DERIVED, NOT STORED, and deliberately: it is the SAME
 * question D-141's invariant asks — *does a verified factor exist?* — read from
 * the same column. A `UserAccountStatus.MFA_PENDING` enum member would be a
 * second copy of that fact, free to drift from `TwoFactor.verified`, and the
 * drift would be silent and in the unsafe direction. `UserAccount.status` keeps
 * meaning what it means: may this account hold a session at all.
 *
 * SCOPE, STATED HONESTLY. Today this treats EVERY account with no verified
 * factor as pending, and in v1 that is exactly right: `admin:create` is the
 * only way an account comes into existence (`enforceServerSideSignUpOnly`), and
 * D-166 makes MFA mandatory for administrators. When the `users` module
 * provisions accounts for people who are not administrators, this predicate is
 * where the policy question "is a second factor mandatory for THIS account"
 * gets asked — not a new mechanism bolted alongside it.
 *
 * SERVER-ONLY.
 */

import { prisma } from "@/lib/database";

/** Where a pending account is sent, and the only page it may render. */
export const MFA_ENROLMENT_PATH = "/mfa-enrolment";

/**
 * The Better Auth endpoint paths a session belonging to a pending account may
 * still reach. Paths are the plugin's own, i.e. what follows `/api/auth`.
 *
 * DENY BY DEFAULT: anything not named here is refused for such a session, so an
 * endpoint added by a future Better Auth upgrade is closed until somebody
 * decides otherwise. That is the correct direction — refusing an operation to
 * an account that has not finished enrolling can never lock anyone out of
 * enrolling, because the enrolment paths themselves are on this list.
 *
 * Each entry, and why it is here:
 *
 *   `/two-factor/enable`      mints the secret and returns the `otpauth://` URI
 *                             the enrolment page renders as a QR code.
 *   `/two-factor/verify-totp` the code that flips the factor to verified. This
 *                             is the path OUT of the pending state.
 *   `/sign-out`               a pending account must be able to leave. It is
 *                             also the honest answer to "wrong account".
 *   `/get-session`            read-only, and the app's own session helper calls
 *                             it on every request — including on the enrolment
 *                             page itself.
 *
 * NOT on the list, and each omission is deliberate:
 *
 *   `/two-factor/disable`     would let a pending account clear the factor it
 *                             just enrolled without ever proving it. Enrolment
 *                             is not reversible from inside the window.
 *   `/two-factor/verify-backup-code`
 *                             backup codes rescue an account whose
 *                             authenticator is gone. A factor nobody has ever
 *                             verified has no authenticator to lose, and
 *                             accepting a code from the file would complete
 *                             sign-in without the enrolment ever happening.
 *   `/passkey/*`              a passkey is an ADDITIONAL method (D-132), not a
 *                             substitute for the TOTP fallback every account
 *                             retains. Registering one before the fallback
 *                             exists inverts that.
 *   `/update-user`, `/change-email`, `/change-password`, `/delete-user`
 *                             ordinary account operations. They are exactly the
 *                             "can act before the second factor exists" surface.
 *
 * `/sign-in/email` is absent because it needs no exemption: it runs with no
 * session, so the gate never applies to it.
 */
export const MFA_PENDING_ALLOWED_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/enable",
  "/two-factor/verify-totp",
  "/sign-out",
  "/get-session",
]);

/**
 * Thrown when a pending account reaches something it may not have. Carries no
 * detail beyond the state: a denial that enumerates is an enumeration
 * primitive, and there is nothing here worth enumerating anyway.
 */
export class MfaEnrolmentRequiredError extends Error {
  constructor() {
    super(
      "This account has no verified MFA factor yet, so it may only sign in " +
        `and enrol. Finish enrolment at ${MFA_ENROLMENT_PATH}.`,
    );
    this.name = "MfaEnrolmentRequiredError";
  }
}

/**
 * Does this account hold a VERIFIED second factor?
 *
 * `TwoFactor.verified` and not `UserAccount.twoFactorEnabled`. The two are
 * written by different steps of Better Auth's own flow — `enableTwoFactor`
 * creates the row with `verified: false` and leaves `twoFactorEnabled` alone;
 * `verifyTOTP` sets both — so between them there is a real instant at which the
 * flag says nothing useful. `verified` is also the column D-141's invariant
 * reads, and asking one question two ways is how the two answers diverge.
 */
export async function hasVerifiedMfaFactor(
  userAccountId: string,
): Promise<boolean> {
  const factor = await prisma.twoFactor.findFirst({
    where: { userId: userAccountId, verified: true },
    select: { id: true },
  });
  return factor !== null;
}

/**
 * The same question for the account behind a Better Auth session token, for the
 * HTTP gate — which has a cookie and no resolved session.
 *
 * Resolved through OUR OWN `Session` table rather than through Better Auth's
 * session API, on purpose: calling the auth instance from inside one of its own
 * `before` hooks re-enters the pipeline the hook is guarding. Returns `null`
 * when the token matches no live session, which the caller reads as "no session
 * to gate" — an anonymous request is not this gate's business.
 */
export async function mfaStateForSessionToken(
  token: string,
): Promise<{ userAccountId: string; pending: boolean } | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    select: { userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt.getTime() <= Date.now()) return null;

  return {
    userAccountId: session.userId,
    pending: !(await hasVerifiedMfaFactor(session.userId)),
  };
}
