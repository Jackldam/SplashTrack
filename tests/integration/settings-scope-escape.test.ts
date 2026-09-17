/**
 * Scope escape for the settings write path (D-030) and the diagnostics read
 * gate (D-156): does `updateSetting` actually refuse a principal holding no
 * `organization.settings.manage` grant, and one holding the permission at a
 * narrower scope than `ORGANIZATION`? `organization.settings.manage` and
 * `diagnostics.read` are both `{ organization: true }`-scoped resources — the
 * settings registry has nothing narrower to name, an instance-wide document —
 * so this suite is the same shape as `backup-scope-escape.test.ts`: a real
 * `Person` + `Role` + `RoleAssignment`, no `ScopeRelations` fixtures needed.
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError, requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { updateSetting } from "@/modules/settings";

const PREFIX = "esc_settings_";

function id(suffix: string): string {
  return `${PREFIX}${randomUUID().slice(0, 8)}_${suffix}`;
}

async function makePerson(suffix: string): Promise<string> {
  const personId = id(suffix);
  await prisma.person.create({
    data: { id: personId, givenName: "Fixture", familyName: suffix },
  });
  return personId;
}

async function makeRoleWithPermission(
  suffix: string,
  key: string,
): Promise<string> {
  const roleId = id(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  const permissionId = `${PREFIX}perm_${key.replace(/\./g, "_")}`;
  await prisma.permission.upsert({
    where: { id: permissionId },
    update: {},
    create: { id: permissionId, key },
  });
  await prisma.rolePermission.create({ data: { roleId, permissionId } });
  return roleId;
}

async function grant(
  personId: string,
  roleId: string,
  scopeType: "ORGANIZATION" | "GROUP",
  scopeId: string | null,
): Promise<void> {
  await prisma.roleAssignment.create({
    data: {
      personId,
      roleId,
      scopeType,
      scopeId,
      validFrom: new Date("2020-01-01T00:00:00Z"),
      validUntil:
        scopeType === "GROUP" ? new Date("2099-01-01T00:00:00Z") : null,
    },
  });
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
  await prisma.person.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeEach(cleanup);
afterEach(cleanup);

describe("organization.settings.manage / diagnostics.read scope escape (D-030/D-156)", () => {
  it("refuses updateSetting to a principal holding no grant at all", async () => {
    const bystanderId = await makePerson("bystander");

    await expect(
      updateSetting({
        principal: { personId: bystanderId },
        key: "organization.supportEmail",
        value: "hello@example.com",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses a GROUP-scoped grant of organization.settings.manage — it does not widen to instance-wide", async () => {
    const personId = await makePerson("group_scoped");
    const roleId = await makeRoleWithPermission(
      "role_group",
      "organization.settings.manage",
    );
    // A GROUP scope needs a real referent to resolve through `resolveReach`;
    // any id is enough here because the coverage check must fail BEFORE it
    // would need to resolve group membership — a settings write names an
    // organization resource, and no GROUP-scoped grant can cover that.
    await grant(personId, roleId, "GROUP", id("some_group"));

    await expect(
      updateSetting({
        principal: { personId },
        key: "organization.supportEmail",
        value: "hello@example.com",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("allows an ORGANIZATION-scoped grant of organization.settings.manage", async () => {
    const personId = await makePerson("org_scoped");
    const roleId = await makeRoleWithPermission(
      "role_org",
      "organization.settings.manage",
    );
    await grant(personId, roleId, "ORGANIZATION", null);

    const result = await updateSetting({
      principal: { personId },
      key: "organization.supportEmail",
      value: "hello@example.com",
    });
    expect(result.value).toBe("hello@example.com");
  });

  it("diagnostics.read is a distinct permission from organization.settings.manage — holding one does not imply the other", async () => {
    const personId = await makePerson("settings_only");
    const roleId = await makeRoleWithPermission(
      "role_settings_only",
      "organization.settings.manage",
    );
    await grant(personId, roleId, "ORGANIZATION", null);

    await expect(
      requirePermission({ personId }, "diagnostics.read", {
        organization: true,
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});
