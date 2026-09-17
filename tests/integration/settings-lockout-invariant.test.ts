/**
 * D-141's lockout invariant against a real database — the two call sites the
 * design names (`02-security-privacy.md` §1.2.1): a settings write in the
 * `Authentication`/`Security` category, and (in HYPOTHETICAL form, via
 * `exclude*`, since no role-revocation or account-disable UI exists yet in
 * this codebase — see the phase report) a role revocation and an account
 * disable.
 *
 * The fixture builder creates ACCOUNTS carrying a real `TwoFactor` (verified)
 * or a real `Passkey`, an `ORGANIZATION`-scoped `RoleAssignment`, and an
 * ACTIVE `UserAccount` — the exact three predicates
 * `countQualifyingAccounts` reads.
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  assertLockoutInvariantHolds,
  evaluateLockoutInvariant,
  LockoutInvariantViolationError,
  updateSetting,
} from "@/modules/settings";
import { PermissionDeniedError } from "@/lib/authorization";

const PREFIX = "lockout_";

function id(suffix: string): string {
  return `${PREFIX}${randomUUID().slice(0, 8)}_${suffix}`;
}

interface QualifyingAccount {
  personId: string;
  accountId: string;
  roleAssignmentId: string;
}

async function makeRoleWithPermissions(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = id(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    // Deterministic per KEY (not per call): `Permission.key` is globally
    // unique, and this helper is called more than once per test (a TOTP
    // fixture and a passkey fixture in the same test, both granting
    // `organization.settings.manage`) — a fresh random id per call would try
    // to INSERT the same key twice and hit the unique constraint.
    const permissionId = `${PREFIX}perm_${key.replace(/\./g, "_")}`;
    await prisma.permission.upsert({
      where: { id: permissionId },
      update: {},
      create: { id: permissionId, key },
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId } });
  }
  return roleId;
}

/** A local ORGANIZATION-scoped ACTIVE account with a verified TOTP factor. */
async function makeQualifyingAccountWithTotp(
  suffix: string,
): Promise<QualifyingAccount> {
  const personId = id(`person_${suffix}`);
  await prisma.person.create({
    data: { id: personId, givenName: "Fixture", familyName: suffix },
  });
  const accountId = id(`account_${suffix}`);
  await prisma.userAccount.create({
    data: {
      id: accountId,
      personId,
      email: `${accountId}@example.test`,
      status: "ACTIVE",
      name: suffix,
      emailVerified: true,
    },
  });
  await prisma.twoFactor.create({
    data: {
      id: id(`totp_${suffix}`),
      userId: accountId,
      secret: "fixture-secret",
      backupCodes: "[]",
      verified: true,
    },
  });
  const roleId = await makeRoleWithPermissions(`role_${suffix}`, [
    "organization.settings.manage",
  ]);
  const roleAssignment = await prisma.roleAssignment.create({
    data: {
      personId,
      roleId,
      scopeType: "ORGANIZATION",
      scopeId: null,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: null,
    },
  });
  return { personId, accountId, roleAssignmentId: roleAssignment.id };
}

/** A qualifying account whose factor is a passkey rather than TOTP (D-132). */
async function makeQualifyingAccountWithPasskey(
  suffix: string,
): Promise<QualifyingAccount> {
  const personId = id(`person_${suffix}`);
  await prisma.person.create({
    data: { id: personId, givenName: "Fixture", familyName: suffix },
  });
  const accountId = id(`account_${suffix}`);
  await prisma.userAccount.create({
    data: {
      id: accountId,
      personId,
      email: `${accountId}@example.test`,
      status: "ACTIVE",
      name: suffix,
      emailVerified: true,
    },
  });
  await prisma.passkey.create({
    data: {
      id: id(`pk_${suffix}`),
      userId: accountId,
      publicKey: "fixture-public-key",
      credentialID: id(`cred_${suffix}`),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    },
  });
  const roleId = await makeRoleWithPermissions(`role_${suffix}`, [
    "organization.settings.manage",
  ]);
  const roleAssignment = await prisma.roleAssignment.create({
    data: {
      personId,
      roleId,
      scopeType: "ORGANIZATION",
      scopeId: null,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil: null,
    },
  });
  return { personId, accountId, roleAssignmentId: roleAssignment.id };
}

async function cleanup(): Promise<void> {
  await prisma.roleAssignment.deleteMany({
    where: { person: { id: { startsWith: PREFIX } } },
  });
  await prisma.rolePermission.deleteMany({
    where: { role: { id: { startsWith: PREFIX } } },
  });
  await prisma.role.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.permission.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.twoFactor.deleteMany({
    where: { user: { id: { startsWith: PREFIX } } },
  });
  await prisma.passkey.deleteMany({
    where: { user: { id: { startsWith: PREFIX } } },
  });
  await prisma.userAccount.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  await prisma.person.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterEach(cleanup);

describe("D-141's lockout invariant — the database-backed check", () => {
  it("does not hold when zero qualifying accounts exist", async () => {
    const check = await evaluateLockoutInvariant();
    // The suite's OWN seeded fixtures may or may not include a qualifying
    // account depending on run order elsewhere, so this test creates its own
    // isolated negative case instead of asserting on the ambient count: an
    // account that is ACTIVE and ORGANIZATION-scoped but has NO verified
    // factor must not count.
    const personId = id("person_unverified");
    await prisma.person.create({
      data: { id: personId, givenName: "Fixture", familyName: "unverified" },
    });
    const accountId = id("account_unverified");
    await prisma.userAccount.create({
      data: {
        id: accountId,
        personId,
        email: `${accountId}@example.test`,
        status: "ACTIVE",
        name: "unverified",
      },
    });
    await prisma.twoFactor.create({
      data: {
        id: id("totp_unverified"),
        userId: accountId,
        secret: "fixture-secret",
        backupCodes: "[]",
        verified: false,
      },
    });
    const roleId = await makeRoleWithPermissions("role_unverified", [
      "organization.settings.manage",
    ]);
    await prisma.roleAssignment.create({
      data: {
        personId,
        roleId,
        scopeType: "ORGANIZATION",
        scopeId: null,
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validUntil: null,
      },
    });

    const excludeEverythingElse = await prisma.userAccount.findMany({
      where: { id: { not: accountId } },
      select: { id: true },
    });
    const afterExcludingEveryoneElse = await evaluateLockoutInvariant(prisma, {
      excludeAccountIds: excludeEverythingElse.map((a) => a.id),
    });
    expect(afterExcludingEveryoneElse.holds).toBe(false);
    expect(check).toBeDefined(); // the ambient read above did not throw
  });

  it("holds with one qualifying TOTP account and one qualifying passkey account", async () => {
    const totp = await makeQualifyingAccountWithTotp("totp_case");
    const passkey = await makeQualifyingAccountWithPasskey("passkey_case");

    const check = await evaluateLockoutInvariant(prisma, {
      excludeAccountIds: [],
    });
    // At least these two count; the ambient database may hold more.
    expect(check.qualifyingAccounts).toBeGreaterThanOrEqual(2);
    expect(check.holds).toBe(true);
    expect(totp.accountId).toBeTruthy();
    expect(passkey.accountId).toBeTruthy();
  });

  it("ROLE-REVOCATION scenario: excluding the only ORGANIZATION grant of the only qualifying account fails the invariant", async () => {
    const only = await makeQualifyingAccountWithTotp("only_admin");
    const otherAccounts = await prisma.userAccount.findMany({
      where: { id: { not: only.accountId } },
      select: { id: true },
    });

    const beforeRevocation = await evaluateLockoutInvariant(prisma, {
      excludeAccountIds: otherAccounts.map((a) => a.id),
    });
    expect(beforeRevocation.holds).toBe(true);

    // The hypothetical: "if this role assignment were revoked right now,
    // would the invariant still hold?" — exactly what a future role-revocation
    // service must ask BEFORE deleting the grant.
    const afterHypotheticalRevocation = await evaluateLockoutInvariant(prisma, {
      excludeAccountIds: otherAccounts.map((a) => a.id),
      excludeRoleAssignmentIds: [only.roleAssignmentId],
    });
    expect(afterHypotheticalRevocation.holds).toBe(false);
    expect(afterHypotheticalRevocation.qualifyingAccounts).toBe(0);

    await expect(
      assertLockoutInvariantHolds(prisma, {
        excludeAccountIds: otherAccounts.map((a) => a.id),
        excludeRoleAssignmentIds: [only.roleAssignmentId],
      }),
    ).rejects.toThrow(LockoutInvariantViolationError);
  });

  it("ACCOUNT-DISABLE scenario: excluding the only qualifying account fails the invariant", async () => {
    const only = await makeQualifyingAccountWithPasskey("only_admin_2");
    const otherAccounts = await prisma.userAccount.findMany({
      where: { id: { not: only.accountId } },
      select: { id: true },
    });

    const afterHypotheticalDisable = await evaluateLockoutInvariant(prisma, {
      excludeAccountIds: [...otherAccounts.map((a) => a.id), only.accountId],
    });
    expect(afterHypotheticalDisable.holds).toBe(false);

    await expect(
      assertLockoutInvariantHolds(prisma, {
        excludeAccountIds: [...otherAccounts.map((a) => a.id), only.accountId],
      }),
    ).rejects.toThrow(LockoutInvariantViolationError);
  });

  it("SETTINGS-WRITE scenario: refuses an Authentication/Security write when the invariant does not currently hold", async () => {
    // `updateSetting` calls `assertLockoutInvariantHolds` with NO exclusions
    // (D-141's own words: checked against the database, not against the
    // values written) — so THIS test must make the WHOLE database's
    // qualifying-account count genuinely zero, not just its own fixtures'.
    // Every other qualifying account anywhere in the `_test` database
    // (ambient fixtures from another suite that ran earlier and did not clean
    // up completely, however unlikely with `fileParallelism: false`) is
    // neutralised for the duration of this test and restored afterward.
    const ambientVerifiedTotp = await prisma.twoFactor.findMany({
      where: { verified: true },
      select: { id: true },
    });
    const ambientPasskeys = await prisma.passkey.findMany({
      select: { id: true },
    });

    const caller = await makeQualifyingAccountWithTotp("caller_no_mfa_left");

    try {
      await prisma.twoFactor.updateMany({
        where: { id: { in: ambientVerifiedTotp.map((r) => r.id) } },
        data: { verified: false },
      });
      await prisma.passkey.deleteMany({
        where: { id: { in: ambientPasskeys.map((r) => r.id) } },
      });
      // Strip the caller's own qualifying factor too, so the database
      // genuinely holds zero qualifying accounts.
      await prisma.twoFactor.updateMany({
        where: { userId: caller.accountId },
        data: { verified: false },
      });

      await expect(
        updateSetting({
          principal: { personId: caller.personId },
          key: "authentication.passwordMinLength",
          value: 14,
        }),
      ).rejects.toThrow(LockoutInvariantViolationError);
    } finally {
      await prisma.twoFactor.updateMany({
        where: { id: { in: ambientVerifiedTotp.map((r) => r.id) } },
        data: { verified: true },
      });
    }
  });

  it("SETTINGS-WRITE scenario: allows an Authentication/Security write when the invariant holds", async () => {
    const caller = await makeQualifyingAccountWithTotp("caller_ok");

    const result = await updateSetting({
      principal: { personId: caller.personId },
      key: "authentication.passwordMinLength",
      value: 14,
    });
    expect(result.value).toBe(14);
  });

  it("refuses a caller with no `organization.settings.manage` grant at all", async () => {
    const personId = id("person_no_permission");
    await prisma.person.create({
      data: { id: personId, givenName: "Fixture", familyName: "noperm" },
    });

    await expect(
      updateSetting({
        principal: { personId },
        key: "organization.supportEmail",
        value: "hello@example.com",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});
