"use server";

/**
 * The two steps of an interactive sign-in, as Server Actions.
 *
 * DELIBERATELY SMALL. This is not the portal's authentication surface — that
 * arrives with the first module, along with password reset, passkey sign-in and
 * everything else Better Auth already exposes. This exists because the
 * deployment surface's whole purpose is that a real person can log in, and an
 * instance nobody can reach through a browser has not proved that.
 *
 * WHAT IT DOES NOT DO, on purpose:
 *   - it does not tell the caller WHY a sign-in failed. Unknown email, wrong
 *     password and disabled account produce one message, because distinguishing
 *     them is an account-enumeration primitive. Better Auth throws the same
 *     error for all three; this keeps it that way.
 *   - it does not log the email, the password or the code. The audit trail
 *     records the outcome with identifiers only, from the hooks in
 *     `@/lib/auth/auth.ts`.
 *   - it sets no cookie itself. Better Auth's `nextCookies()` plugin, last in
 *     the plugin list, is what carries a Set-Cookie out of a Server Action —
 *     doing it by hand would drop `httpOnly`, `secure` and `sameSite`.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/** Step 1 — email and password. Ends at the MFA challenge, never at a session. */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch {
    redirect("/sign-in?error=credentials");
  }
  redirect("/sign-in");
}

/** Step 2 — the six-digit code from the account's authenticator. */
export async function verifyTotpCode(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();

  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch {
    redirect("/sign-in?error=code");
  }
  redirect("/");
}

/** Abandons a pending MFA challenge and starts again from the password step. */
export async function abandonChallenge(): Promise<void> {
  const { clearTwoFactorChallengeCookies } = await import("./challenge");
  await clearTwoFactorChallengeCookies();
  redirect("/sign-in");
}
