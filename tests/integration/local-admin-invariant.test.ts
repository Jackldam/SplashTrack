/**
 * D-141's invariant, clause by clause.
 *
 * > *at least one **local** `ORGANIZATION`-scoped account with a **verified**
 * > MFA factor exists at all times*
 *
 * Every word of that is load-bearing, and a predicate that quietly ignored one
 * of them would look correct and would be the difference between an operator
 * who can recover their instance and one who cannot. So there is a case per
 * clause, each of which takes a satisfying account and breaks exactly one
 * thing.
 *
 * The negative cases matter more than the positive one. An invariant that
 * over-counts reports "you still have an administrator" to somebody about to
 * disable the last one.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertLocalAdminInvariantHolds,
  countLocalOrganizationAdmins,
  LocalAdminInvariantError,
} from "@/lib/auth/local-admin-invariant";
import { prisma } from "@/lib/database";

const PREFIX = "d141fx";

/** Everything this file creates, removed in reverse dependency order. */
async function cleanUp(): Promise<void> {
  await prisma.roleAssignment.deleteMany({
    where: { personId: { startsWith: PREFIX } },
  });
  await prisma.twoFactor.deleteMany({
    where: { userId: { startsWith: PREFIX } },
  });
  await prisma.account.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.userAccount.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.rolePermission.deleteMany({
    where: { roleId: { startsWith: PREFIX } },
  });
  await prisma.role.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.permission.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
}

/**
 * A person + local account + verified TOTP + an ORGANIZATION-scoped grant of a
 * role carrying `roles.assign`. Every override switches off exactly one clause.
 */
async function seedAdmin(
  suffix: string,
  overrides: {
    local?: boolean;
    verifiedMfa?: boolean;
    scopeType?: "ORGANIZATION" | "UNIT";
    disabled?: boolean;
    validFrom?: Date;
    validUntil?: Date | null;
    roleId?: string;
  } = {},
): Promise<string> {
  const id = `${PREFIX}_${suffix}`;

  await prisma.person.create({
    data: { id, givenName: "Test", familyName: suffix },
  });
  await prisma.userAccount.create({
    data: {
      id,
      personId: id,
      email: `${id}@example.test`,
      name: `Test ${suffix}`,
      status: overrides.disabled ? "DISABLED" : "ACTIVE",
      twoFactorEnabled: overrides.verifiedMfa !== false,
    },
  });

  if (overrides.local !== false) {
    await prisma.account.create({
      data: {
        id: `${id}_cred`,
        accountId: id,
        providerId: "credential",
        issuer: "credential",
        userId: id,
        // A hash-shaped placeholder. Nothing here verifies a password; the
        // clause is "a local credential with a password EXISTS".
        password: "argon2id$placeholder",
      },
    });
  }

  await prisma.twoFactor.create({
    data: {
      id: `${id}_2fa`,
      userId: id,
      secret: "encrypted-placeholder",
      backupCodes: "encrypted-placeholder",
      verified: overrides.verifiedMfa !== false,
    },
  });

  await prisma.roleAssignment.create({
    data: {
      personId: id,
      roleId: overrides.roleId ?? `${PREFIX}_admin_role`,
      scopeType: overrides.scopeType ?? "ORGANIZATION",
      scopeId: overrides.scopeType === "UNIT" ? "some-unit" : null,
      validFrom: overrides.validFrom ?? new Date(),
      validUntil: overrides.validUntil ?? null,
    },
  });

  return id;
}

beforeEach(async () => {
  await cleanUp();

  // The administrator role, defined by the PERMISSION it carries and never by
  // its name (D-130): roles are user-definable, so a name is not a predicate.
  await prisma.role.create({
    data: { id: `${PREFIX}_admin_role`, key: `${PREFIX}_admin`, name: "Admin" },
  });

  // The predicate keys on `roles.assign`. The row is created under THIS file's
  // id prefix when it is absent, so `cleanUp` takes it away again: the suite
  // shares one database, `Permission.key` is unique, and a `roles.assign` row
  // left behind here makes `tests/support/authorization-fixtures.ts` — which
  // upserts by ID, not by key — fail on the unique key in every other file.
  const existing = await prisma.permission.findUnique({
    where: { key: "roles.assign" },
    select: { id: true },
  });
  const permissionId =
    existing?.id ??
    (
      await prisma.permission.create({
        data: { id: `${PREFIX}_roles_assign`, key: "roles.assign" },
        select: { id: true },
      })
    ).id;
  await prisma.rolePermission.create({
    data: { roleId: `${PREFIX}_admin_role`, permissionId },
  });

  // A role that carries no administrator permission, for the negative case.
  await prisma.role.create({
    data: {
      id: `${PREFIX}_other_role`,
      key: `${PREFIX}_other`,
      name: "Not an admin",
    },
  });
});

afterEach(cleanUp);

describe("D-141 — a local ORGANIZATION admin with a verified MFA factor", () => {
  it("counts an account that satisfies every clause", async () => {
    await seedAdmin("full");
    expect(await countLocalOrganizationAdmins()).toBe(1);
  });

  it("does NOT count an account with no local credential", async () => {
    // The clause exists because the recovery this invariant protects is
    // recovery from a BROKEN external provider. An account that can only sign
    // in through that provider is no help.
    await seedAdmin("sso_only", { local: false });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("does NOT count an enrolled-but-unverified MFA factor", async () => {
    // Nobody has proved they hold the secret, so the account cannot complete a
    // sign-in — counting it would satisfy the invariant with an unusable login.
    await seedAdmin("unverified", { verifiedMfa: false });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("does NOT count a UNIT-scoped grant", async () => {
    await seedAdmin("unit_scoped", { scopeType: "UNIT" });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("does NOT count a role without an administrator permission", async () => {
    await seedAdmin("wrong_role", { roleId: `${PREFIX}_other_role` });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("does NOT count a disabled account", async () => {
    await seedAdmin("disabled", { disabled: true });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("does NOT count a grant whose window has closed", async () => {
    // "at all times" is why the window is evaluated live. A 24-hour
    // `admin:grant-admin` satisfies this while it lasts and stops when it
    // expires — which is the honest reading of a recovery grant.
    // `validFrom` is in the past too: the schema refuses a window that ends
    // before it begins, which is itself the right constraint.
    await seedAdmin("expired", {
      validFrom: new Date(Date.now() - 48 * 60 * 60 * 1000),
      validUntil: new Date(Date.now() - 60_000),
    });
    expect(await countLocalOrganizationAdmins()).toBe(0);
  });

  it("counts a grant whose window is still open", async () => {
    await seedAdmin("bounded", {
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    expect(await countLocalOrganizationAdmins()).toBe(1);
  });

  it("answers 'would it still hold after this' without a speculative write", async () => {
    const only = await seedAdmin("only");
    expect(await countLocalOrganizationAdmins()).toBe(1);
    expect(await countLocalOrganizationAdmins(only)).toBe(0);
  });

  it("refuses an action that would leave none, and names it", async () => {
    const only = await seedAdmin("only");

    await expect(
      assertLocalAdminInvariantHolds("Disabling this account", only),
    ).rejects.toBeInstanceOf(LocalAdminInvariantError);

    // And permits it when a second administrator exists.
    await seedAdmin("second");
    await expect(
      assertLocalAdminInvariantHolds("Disabling this account", only),
    ).resolves.toBeUndefined();
  });
});
