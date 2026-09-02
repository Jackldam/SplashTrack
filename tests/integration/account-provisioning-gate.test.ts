import { afterEach, describe, expect, it } from "vitest";

import {
  accountProvisioningMarker,
  auth,
  personCreationTracker,
} from "@/lib/auth";
import { prisma } from "@/lib/database";

/**
 * Account creation is DENIED BY DEFAULT, and only server-side provisioning may
 * do it.
 *
 * This test exists because the hole was real, not hypothetical. Probing the
 * phase-0.2 extraction against a running build, an unauthenticated
 * `POST /api/auth/sign-up/email` returned HTTP 200 with a session token and
 * left an ACTIVE `UserAccount` and a `Person` behind: `/api/auth/[...all]`
 * mounts Better Auth's full endpoint surface, and `emailAndPassword.enabled`
 * puts sign-up on it. Public self-registration is out of v1 (R-12), so that is
 * a stranger creating an account on a system holding children's records.
 *
 * `enforceServerSideSignUpOnly` (`@/lib/auth/auth.ts`) closes it. Both
 * directions are asserted here, because a gate that only ever gets tested in
 * the "refused" direction is one refactor away from refusing everything —
 * including the administrator provisioning an instructor's account, which is
 * the ONLY way an account is ever created in v1.
 *
 * It also pins the identity-model invariant the create hook exists for: every
 * `UserAccount` is linked to a `Person`, and `personCreationTracker` can report
 * which `Person` a call created — the rollback handle that keeps a failed
 * sign-up from leaving an orphaned personal-data row behind.
 */

const EMAIL = "provisioning-gate-probe@example.invalid";
// Above `PASSWORD_POLICY.minLength` (12). Nothing here is a real credential:
// the account exists for the duration of one test file against the disposable
// `_test` database.
const PASSWORD = "correct-horse-battery-staple";

async function deleteProbeAccount(): Promise<void> {
  const account = await prisma.userAccount.findUnique({
    where: { email: EMAIL },
    select: { id: true, personId: true },
  });
  if (!account) return;
  // Session / Account / TwoFactor / Passkey cascade from UserAccount; Person is
  // Restrict, so it is deleted explicitly and second — the same ordering a real
  // erasure has to use.
  await prisma.userAccount.delete({ where: { id: account.id } });
  await prisma.person.delete({ where: { id: account.personId } });
}

afterEach(async () => {
  await deleteProbeAccount();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"');
});

describe("account creation is denied by default", () => {
  it("refuses sign-up when it is not server-side provisioning", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { email: EMAIL, password: PASSWORD, name: "Stranger" },
      }),
    ).rejects.toThrow();

    // The important half: nothing was written. A gate that throws AFTER
    // creating the Person would still leak a personal-data row.
    await expect(
      prisma.userAccount.findUnique({ where: { email: EMAIL } }),
    ).resolves.toBeNull();
  });

  it("allows server-side provisioning and links the account to a Person", async () => {
    const tracked: { personId?: string } = {};

    const result = await personCreationTracker.run(tracked, () =>
      accountProvisioningMarker.run(true, () =>
        auth.api.signUpEmail({
          body: { email: EMAIL, password: PASSWORD, name: "Instructeur Test" },
        }),
      ),
    );

    expect(result).toBeTruthy();

    const account = await prisma.userAccount.findUnique({
      where: { email: EMAIL },
      select: {
        id: true,
        status: true,
        personId: true,
        person: { select: { givenName: true, familyName: true } },
      },
    });

    expect(account).not.toBeNull();
    expect(account!.status).toBe("ACTIVE");
    // The `user.create.before` hook created the Person and injected its id.
    expect(account!.personId).toBe(tracked.personId);
    // A single Better Auth `name` is split into the structured Person columns.
    expect(account!.person).toEqual({
      givenName: "Instructeur",
      familyName: "Test",
    });

    // The password hash lives on `Account`, never on `UserAccount` or `Person`.
    const credential = await prisma.account.findFirst({
      where: { userId: account!.id, providerId: "credential" },
      select: { password: true, issuer: true },
    });
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toBe(PASSWORD);
    // `issuer` is required by Better Auth 1.7 and absent from the template's
    // schema — the omission that made sign-up throw during extraction.
    expect(credential?.issuer).toBe("local:credential");
  });
});
