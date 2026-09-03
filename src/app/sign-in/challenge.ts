/**
 * Is there a pending second-factor challenge for this browser?
 *
 * The two-factor plugin signs a short-lived cookie between the password step
 * and the code step. Its name depends on whether cookies are being issued with
 * the `__Secure-` prefix, which follows the app's public URL scheme — so both
 * spellings are checked rather than one guessed.
 */

import { cookies } from "next/headers";

const CHALLENGE_COOKIE = "better-auth.two_factor";
const SECURE_CHALLENGE_COOKIE = `__Secure-${CHALLENGE_COOKIE}`;

export async function hasTwoFactorChallenge(): Promise<boolean> {
  const jar = await cookies();
  return jar.has(CHALLENGE_COOKIE) || jar.has(SECURE_CHALLENGE_COOKIE);
}

export async function clearTwoFactorChallengeCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(CHALLENGE_COOKIE);
  jar.delete(SECURE_CHALLENGE_COOKIE);
}
