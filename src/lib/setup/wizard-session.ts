/**
 * The wizard's own short-lived cookie — what carries an operator from the token
 * step to the administrator step without re-typing the token.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS, AND WHAT IT DOES NOT
 *
 * Exactly one fact: *this browser presented the one-time setup token before it
 * expired*. It is not a session, it names no account, it carries no
 * authorization, and it survives nothing.
 *
 * IT IS NOT THE GATE. The gate is the BOOT STATE (`./gate.ts`): once setup
 * completes, `/setup` answers 404 to every caller, cookie or no cookie. This
 * cookie only decides whether a caller who has ALREADY got past that gate has
 * to type the token again. That layering is what makes D-039's "self-destructs"
 * true of the surface rather than of a credential — the wizard closes because
 * the installation changed state, not because something was revoked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATELESS AND SIGNED, RATHER THAN A ROW OR A MAP
 *
 * A row is impossible: the state this opens in is `EMPTY` — no tables at all.
 * A module-level `Map` would be lost on a container restart, and the token is
 * SINGLE-USE, so a restart between typing the token and choosing a password
 * would strand the operator with a consumed token and no way back except a host
 * command. An HMAC over an expiry is the shape that survives a restart while
 * holding no state at all.
 *
 * `HKDF(SECRET_KEY, info="setup-session-v1")` (D-112). A label of its own so a
 * value minted here is not forged in Better Auth's session-signing key space.
 *
 * SERVER-ONLY.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { BETTER_AUTH_COOKIE_ATTRIBUTES } from "@/lib/auth/auth";
import { deriveKey } from "@/lib/crypto";

/**
 * Scoped to `/setup` with `Path`, so it is not sent to any other route of the
 * application — including after setup completes, when the path no longer
 * resolves. `httpOnly`, `sameSite` and `secure` come from the one home for
 * those attributes rather than being restated (a bare `cookies().set()` in
 * Next.js defaults none of them).
 */
export const WIZARD_COOKIE = "splashtrack.setup";
const COOKIE_PATH = "/setup";

/**
 * How long the wizard may be walked after the token is exchanged. Generous
 * on purpose: the remaining steps are choosing a password and enrolling an
 * authenticator on a phone, and a cookie that expires mid-enrolment costs the
 * operator a consumed token.
 */
export const WIZARD_SESSION_TTL_MINUTES = 60;

interface WizardClaim {
  /** Expiry, epoch milliseconds. The only field, because it is the only fact. */
  exp: number;
}

/** Mints a signed value. Pure — exported for the test that tries to forge one. */
export function mintWizardSession(now: Date = new Date()): string {
  const claim: WizardClaim = {
    exp: now.getTime() + WIZARD_SESSION_TTL_MINUTES * 60 * 1000,
  };
  const payload = Buffer.from(JSON.stringify(claim), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

/** True when `value` is a signature this instance made and has not expired. */
export function verifyWizardSession(
  value: string | undefined,
  now: Date = new Date(),
): boolean {
  if (!value) return false;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);

  const expected = Buffer.from(sign(payload), "utf8");
  const presented = Buffer.from(signature, "utf8");
  if (expected.length !== presented.length) return false;
  if (!timingSafeEqual(expected, presented)) return false;

  // Only AFTER the signature holds is the payload parsed. Parsing first would
  // mean feeding unauthenticated bytes to `JSON.parse` and then trusting a
  // number out of it, which is the shape that turns a MAC into decoration.
  try {
    const claim = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<WizardClaim>;
    return typeof claim.exp === "number" && claim.exp > now.getTime();
  } catch {
    return false;
  }
}

/** Sets the cookie on the caller's response. */
export async function startWizardSession(): Promise<void> {
  const jar = await cookies();
  jar.set(WIZARD_COOKIE, mintWizardSession(), {
    ...BETTER_AUTH_COOKIE_ATTRIBUTES,
    path: COOKIE_PATH,
    maxAge: WIZARD_SESSION_TTL_MINUTES * 60,
  });
}

/** Whether THIS request carries a valid wizard cookie. */
export async function hasWizardSession(): Promise<boolean> {
  const jar = await cookies();
  return verifyWizardSession(jar.get(WIZARD_COOKIE)?.value);
}

/** Drops the cookie. Called when setup completes, and on an explicit restart. */
export async function endWizardSession(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: WIZARD_COOKIE, path: COOKIE_PATH });
}

function sign(payload: string): string {
  return createHmac("sha256", deriveKey("setup-session-v1"))
    .update(payload)
    .digest("base64url");
}
