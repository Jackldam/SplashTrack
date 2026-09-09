/**
 * An `mfa_pending` account can do exactly two things: sign in, and enrol.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS THE IMPORTANT HALF OF D-185
 *
 * The defect D-185 fixes is a usability one — `admin:create` demanded a code
 * for a secret it had only printed the PATH of, so nobody could finish it. The
 * fix moves enrolment into the browser, which necessarily creates a window in
 * which an ORGANIZATION-scoped administrator account exists behind one
 * password. An account that can ACT inside that window is a worse hole than the
 * one being fixed. So the window is closed server-side, and this file is the
 * proof that it is.
 *
 * IT DRIVES THE REAL HTTP SURFACE, not a helper. `/api/auth/[...all]` mounts
 * every Better Auth endpoint, and `auth.api.*` is the same handler that route
 * dispatches to — so a call here goes through the identical before-hook chain a
 * direct `POST /api/auth/update-user` would. That is the surface the gate has
 * to hold, because it is reachable with a cookie and no application page.
 *
 * The cookie is carried by hand between calls (`sessionCookieOf`), exactly as
 * `src/cli/commands/admin.ts` does, because that is what a browser does.
 */

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  accountProvisioningMarker,
  auth,
  hasVerifiedMfaFactor,
  mfaStateForSessionToken,
} from "@/lib/auth";
import { prisma } from "@/lib/database";

import { disconnectRoleClients, ownerClient } from "../support/database-roles";

const owner = ownerClient();

const EMAIL = "mfa-pending-gate@example.invalid";
const PASSWORD = "correct-horse-battery-staple";

afterAll(async () => {
  await disconnectRoleClients();
});

/** The `Set-Cookie` headers of a response, folded into a `Cookie` request one. */
function sessionCookieOf(response: Response): string {
  const cookies = response.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  return cookies.map((value) => value.split(";")[0]).join("; ");
}

/** The `token` of the session a cookie header carries, as the database sees it. */
function sessionTokenOf(cookie: string): string {
  // Better Auth signs the session cookie: `<token>.<signature>`. The token is
  // everything before the FIRST dot of the cookie's value.
  const pair = cookie
    .split("; ")
    .find((entry) => entry.includes("session_token="));
  expect(pair).toBeTruthy();
  const value = decodeURIComponent(pair!.split("=").slice(1).join("="));
  return value.split(".")[0];
}

/**
 * The TOTP key an `otpauth://` URI carries, in the form `createOTP` wants it.
 *
 * The `secret` parameter is BASE32 of the key, which is what the RFC requires
 * and what an authenticator app decodes. `createOTP(secret)` takes the key
 * itself and base32-encodes it only when building a URI, so the parameter has
 * to be decoded back before a code can be generated from it. Getting this wrong
 * produces six plausible digits that never verify — this helper is the test
 * doing exactly what an authenticator does.
 */
function totpKeyOf(totpURI: string): string {
  const encoded = new URL(totpURI).searchParams.get("secret");
  expect(encoded).toBeTruthy();
  return new TextDecoder().decode(base32.decode(encoded!));
}

/**
 * Creates the account the way `admin:create` now does: a password, and no MFA
 * factor at all. Returns the sign-in cookie — a real session, held by an
 * account with nothing verified.
 */
async function createPendingAccountAndSignIn(): Promise<string> {
  await accountProvisioningMarker.run(true, () =>
    auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "Pending Beheerder" },
      asResponse: true,
    }),
  );

  const signIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  return sessionCookieOf(signIn);
}

async function deleteProbeAccount(): Promise<void> {
  const account = await prisma.userAccount.findUnique({
    where: { email: EMAIL },
    select: { id: true, personId: true },
  });
  if (!account) return;
  await prisma.userAccount.delete({ where: { id: account.id } });
  await prisma.person.delete({ where: { id: account.personId } });
}

beforeEach(deleteProbeAccount);

afterEach(async () => {
  await deleteProbeAccount();
  await owner.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"');
});

describe("an account with no verified MFA factor", () => {
  it("signs in with the password alone — that is the one thing it may do", async () => {
    const cookie = await createPendingAccountAndSignIn();

    // A session really was established. Without this the rest of the file
    // would pass for the wrong reason: everything is refused when nobody is
    // signed in either.
    const state = await mfaStateForSessionToken(sessionTokenOf(cookie));
    expect(state).not.toBeNull();
    expect(state!.pending).toBe(true);

    // And it can read its own session, which the app's session helper does on
    // every request — including on the enrolment page itself.
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).resolves.toBeTruthy();
  });

  it("is refused every other Better Auth endpoint, server-side", async () => {
    const cookie = await createPendingAccountAndSignIn();
    const headers = new Headers({ cookie });

    // Ordinary account operations — the "can act before the second factor
    // exists" surface. Each is reachable by a direct POST to
    // /api/auth/<path> with nothing but this cookie.
    await expect(
      auth.api.updateUser({ body: { name: "Renamed" }, headers }),
    ).rejects.toThrow();

    await expect(
      auth.api.changeEmail({
        body: { newEmail: "elsewhere@example.invalid" },
        headers,
      }),
    ).rejects.toThrow();

    await expect(auth.api.listSessions({ headers })).rejects.toThrow();

    // The two-factor endpoints that are NOT enrolment. `disable` would clear a
    // factor that was never proved; a backup code would complete a sign-in for
    // an authenticator nobody has ever held.
    await expect(
      auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers }),
    ).rejects.toThrow();

    await expect(
      auth.api.verifyBackupCode({ body: { code: "000000" }, headers }),
    ).rejects.toThrow();

    // THE DENIAL IS A DENIAL. Nothing changed: the refusal happened in a
    // before-hook, ahead of the handler, so the name is still what it was.
    const account = await prisma.userAccount.findUnique({
      where: { email: EMAIL },
      select: { name: true, email: true },
    });
    expect(account?.name).toBe("Pending Beheerder");
    expect(account?.email).toBe(EMAIL);
  });

  it("records each refusal as a DENIED audit event naming the path", async () => {
    const cookie = await createPendingAccountAndSignIn();
    await auth.api
      .updateUser({
        body: { name: "Renamed" },
        headers: new Headers({ cookie }),
      })
      .catch(() => undefined);

    const events = await prisma.auditEvent.findMany({
      where: { eventType: "security.mfa_enrolment_required" },
      select: { outcome: true, targetType: true, changedFields: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toBe("DENIED");
    expect(events[0].targetType).toBe("user_account");
    expect(events[0].changedFields).toEqual({ path: "/update-user" });
  });

  it("may enrol, and becomes fully usable the moment the factor verifies", async () => {
    const cookie = await createPendingAccountAndSignIn();
    const headers = new Headers({ cookie });

    // ── enrol ────────────────────────────────────────────────────────────────
    const enrolment = (await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers,
    })) as { totpURI: string; backupCodes: string[] };
    expect(enrolment.totpURI).toMatch(/^otpauth:\/\/totp\//);

    // Enrolled is NOT verified, and the account is still pending: nobody has
    // proved they hold the secret yet. This is the clause D-141 keys on.
    const account = await prisma.userAccount.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true },
    });
    expect(await hasVerifiedMfaFactor(account.id)).toBe(false);
    await expect(
      auth.api.updateUser({ body: { name: "Still refused" }, headers }),
    ).rejects.toThrow();

    // ── verify, with a code generated from the secret the URI carries ────────
    const code = await createOTP(totpKeyOf(enrolment.totpURI)).totp();
    const verified = await auth.api.verifyTOTP({
      body: { code },
      headers,
      asResponse: true,
    });
    expect(verified.status).toBe(200);

    expect(await hasVerifiedMfaFactor(account.id)).toBe(true);

    // ── fully usable, and not before ─────────────────────────────────────────
    // `verifyTOTP` rotates the session, so the caller carries the new cookie
    // exactly as a browser would.
    const afterHeaders = new Headers({ cookie: sessionCookieOf(verified) });
    await expect(
      auth.api.updateUser({
        body: { name: "Now allowed" },
        headers: afterHeaders,
      }),
    ).resolves.toBeTruthy();

    const renamed = await prisma.userAccount.findUnique({
      where: { email: EMAIL },
      select: { name: true },
    });
    expect(renamed?.name).toBe("Now allowed");
  });

  it("rejects a wrong code and stays pending", async () => {
    const cookie = await createPendingAccountAndSignIn();
    const headers = new Headers({ cookie });

    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });

    await expect(
      auth.api.verifyTOTP({ body: { code: "000000" }, headers }),
    ).rejects.toThrow();

    const account = await prisma.userAccount.findUniqueOrThrow({
      where: { email: EMAIL },
      select: { id: true },
    });
    expect(await hasVerifiedMfaFactor(account.id)).toBe(false);
  });
});
