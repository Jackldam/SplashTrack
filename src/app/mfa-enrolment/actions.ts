"use server";

/**
 * The two steps of browser MFA enrolment, as Server Actions (D-185).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN THE CLI ANY MORE
 *
 * `admin:create` used to enrol: it wrote the TOTP secret to a `0600` file,
 * printed only the path — F-20 says self-hosters paste terminal output into
 * public issues, so the secret must never be printed — and then blocked on a
 * prompt demanding a six-digit code. The operator could not open the file
 * without abandoning the prompt. The command could not be completed by the
 * person it exists for.
 *
 * The no-printing requirement is unchanged. What changed is the surface: a
 * browser can draw a QR code, is where every other product enrols an
 * authenticator, and is not something anybody pastes into a chat.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE ACTIONS REFUSE
 *
 * A Server Action is an HTTP endpoint reachable without the page that renders
 * it, so neither of these trusts the page. Both resolve the session themselves,
 * and both refuse a session that is NOT pending — a fully enrolled account must
 * not be able to re-run enrolment from here, because that is a factor swap and
 * it belongs behind re-authentication on a profile surface that does not exist
 * yet. Today the only path to a new factor for an enrolled account is
 * `splashtrack admin:reset-mfa` on the host.
 *
 * NOTHING HERE LOGS THE SECRET, THE PASSWORD, THE CODE OR THE BACKUP CODES.
 * The artefact is returned to the caller's own POST response and to nowhere
 * else; the audit trail records the outcome with identifiers only, from the
 * hooks in `@/lib/auth/auth.ts`.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { APP_VERSION } from "@/lib/app-version";
import { auth, getCurrentSession } from "@/lib/auth";
import { renderTotpEnrolment } from "@/lib/auth/totp-qr";
import { completeSetupIfInvariantHolds } from "@/lib/boot";
import { logger } from "@/lib/logging";

import type { StartEnrolmentState, VerifyEnrolmentState } from "./state";

const enrolmentLogger = logger.child({ component: "mfa.enrolment" });

/**
 * The session, or a redirect. Returns only for an account that is genuinely
 * inside the enrolment window.
 *
 * This is the one place in the application permitted to use
 * `getCurrentSession()` for a protected purpose — `requireEnrolledSession()`
 * would bounce the very callers these actions exist for, straight back here.
 */
async function pendingSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  // Already enrolled: there is nothing to do here, and re-enrolment from this
  // page is deliberately not a feature (see the file comment).
  if (!session.mfaPending) redirect("/");
  return session;
}

/**
 * Step 1 — mint a factor and return it as a QR code plus a typeable key.
 *
 * The password is asked for again, and not as ceremony: Better Auth's
 * `enableTwoFactor` requires it whenever the account holds a password
 * credential, which every account here does. It is the re-authentication that
 * keeps a borrowed session from adding an authenticator the account's owner
 * knows nothing about.
 *
 * Running this twice is safe and is the documented way back after a reload:
 * `enableTwoFactor` REPLACES an existing unverified factor rather than adding a
 * second one, so the previous QR simply stops working.
 */
export async function startEnrolment(
  _previous: StartEnrolmentState,
  formData: FormData,
): Promise<StartEnrolmentState> {
  await pendingSession();
  const password = String(formData.get("password") ?? "");

  let enrolment: { totpURI: string; backupCodes: string[] };
  try {
    enrolment = (await auth.api.enableTwoFactor({
      body: { password },
      headers: await headers(),
    })) as { totpURI: string; backupCodes: string[] };
  } catch {
    // One message for a wrong password and for a malformed one. The account is
    // already identified by the session, so there is no enumeration to protect
    // here — this is simply the same shape `sign-in/actions.ts` uses.
    return { status: "error", reason: "password" };
  }

  try {
    return {
      status: "ready",
      backupCodes: enrolment.backupCodes,
      ...renderTotpEnrolment(enrolment.totpURI),
    };
  } catch (error) {
    // A URI without a `secret`, or a QR the encoder refused. Logged WITHOUT the
    // URI: the whole point of this flow is that the secret has one destination.
    enrolmentLogger.error(
      { event: "mfa.enrolment.render_failed", err: error },
      "could not render the enrolment artefact",
    );
    return { status: "error", reason: "unavailable" };
  }
}

/**
 * Step 2 — verify a code from the authenticator, which is what flips the factor
 * to `verified` and ends the enrolment window.
 *
 * `auth.api.verifyTOTP` does the flip (`TwoFactor.verified = true` plus
 * `UserAccount.twoFactorEnabled`); nothing here writes those columns by hand,
 * because owning Better Auth's TOTP storage format is exactly what the CLI was
 * careful not to do either.
 *
 * On success this is also where SETUP COMPLETES, for the first administrator:
 * `completeSetupIfInvariantHolds` writes the bootstrap record only once D-141's
 * invariant actually holds. That is requirement 5 made true rather than merely
 * displayed.
 */
export async function verifyEnrolment(
  _previous: VerifyEnrolmentState,
  formData: FormData,
): Promise<VerifyEnrolmentState> {
  const session = await pendingSession();
  const code = String(formData.get("code") ?? "").trim();

  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch {
    // Covers a wrong code, an expired one, and the two-factor plugin's own
    // lockout. Better Auth throws the same shape for all three and this must
    // not distinguish them either.
    return { status: "error", reason: "code" };
  }

  const completed = await completeSetupIfInvariantHolds(APP_VERSION);
  enrolmentLogger.info(
    {
      event: "mfa.enrolment.verified",
      userAccountId: session.userAccount.id,
      completedSetup: completed,
    },
    "an MFA factor was verified in the browser",
  );

  redirect("/");
}
