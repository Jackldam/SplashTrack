/**
 * "Seed catalogue + starter roles" — the step D-055's diagram places on the
 * NEW INSTALLATION branch, immediately after migrations and before the first
 * administrator exists.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every write here is an upsert keyed on a stable
 * machine key, so running it twice is a no-op and a half-finished run is
 * resumable — which matters, because `PARTIAL` (D-098 predicate 4) is exactly
 * "setup was interrupted; resume".
 *
 * WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT.
 *
 * Seeded: the whole permission catalogue (`@/lib/authorization`), the
 * `Organization` singleton, and TWO system roles.
 *
 *   - `instance_administrator` — `02-security-privacy.md` §2.4's *Instance
 *     Administrator*: "full control of this installation … this is the highest
 *     authority that exists". It holds the entire catalogue, and it has to:
 *     D-139 lets a granter grant only permissions they themselves hold, so an
 *     administrator missing one could never delegate it, and there is no
 *     principal above them to add it.
 *   - `self` — D-146's seeded `SELF` role, with the CLOSED permission set
 *     `SELF_PERMISSIONS`. D-146 is explicit that `SELF` is an EXPLICIT seeded
 *     assignment and never an implicit match: an implicit one would let
 *     `requirePermission('students.medical.read', {student: self})` pass for an
 *     authenticated person holding no grant at all.
 *
 * NOT seeded: the other eight starter roles in §2.4 — Location Manager,
 * Planner, Instructor, Internal/External examiner, Independent aftest assessor,
 * Member Administrator, Content Editor, Read-only Viewer. §2.4 gives each a
 * typical scope and a sentence of purpose; NO document in the design set states
 * their permission sets, and those sets are not derivable from a sentence.
 * Inventing them here would put a guess into the table that decides who can
 * read a child's medical remark, and §2.4 itself says every starter role is "a
 * starting point, not a fixed object" — they belong to the modules that define
 * the permissions they carry. Seeding an empty role would be worse than not
 * seeding it: a role that grants nothing looks like a misconfiguration.
 *
 * Both seeded roles carry `isSystem: true`, which is what D-171 rests on: the
 * roles module refuses edits to a system role, so an administrator cannot add a
 * permission to `SELF` and pass §2.6's anti-amplification check simply because
 * they hold everything.
 *
 * SERVER-ONLY.
 */

import {
  PERMISSIONS,
  SELF_PERMISSIONS,
  type PermissionKey,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { ORGANIZATION_ID } from "@/lib/settings";

/** The seeded administrator role's machine key. Stable; never renamed. */
export const INSTANCE_ADMINISTRATOR_ROLE_KEY = "instance_administrator";

/** The seeded `SELF` role's machine key (D-146). Stable; never renamed. */
export const SELF_ROLE_KEY = "self";

export interface SeedOutcome {
  permissions: number;
  roles: string[];
  organizationCreated: boolean;
}

/**
 * Seeds the permission catalogue, the organisation singleton and the two system
 * roles. Safe to run repeatedly.
 */
export async function seedInstallation(): Promise<SeedOutcome> {
  const organizationCreated = await seedOrganization();
  await seedPermissions();

  await seedRole({
    key: INSTANCE_ADMINISTRATOR_ROLE_KEY,
    name: "Instance Administrator",
    description:
      "Full control of this installation: settings, roles, backups, audit. " +
      "The highest authority that exists (02-security-privacy.md §2.4).",
    permissions: [...PERMISSIONS],
  });

  await seedRole({
    key: SELF_ROLE_KEY,
    name: "Self",
    description:
      "The closed permission set a person holds over their own records " +
      "(D-146). Assigned explicitly at account creation, never matched " +
      "implicitly.",
    permissions: [...SELF_PERMISSIONS],
  });

  return {
    permissions: PERMISSIONS.size,
    roles: [INSTANCE_ADMINISTRATOR_ROLE_KEY, SELF_ROLE_KEY],
    organizationCreated,
  };
}

/**
 * The organisation singleton (D-027). Created with its default name; the
 * operator renames it in-app. Returns whether this call created it.
 */
async function seedOrganization(): Promise<boolean> {
  const existing = await prisma.organization.findUnique({
    where: { id: ORGANIZATION_ID },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.organization.create({ data: { id: ORGANIZATION_ID } });
  return true;
}

/** Every catalogued permission as a row. Upserted, so adding one is additive. */
async function seedPermissions(): Promise<void> {
  for (const key of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }
}

/**
 * One system role and exactly the permissions named. Permissions no longer in
 * the set are REMOVED, so a permission dropped from the catalogue does not
 * linger as a grant on the highest-privilege role in the product.
 */
async function seedRole(role: {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}): Promise<void> {
  const row = await prisma.role.upsert({
    where: { key: role.key },
    update: { name: role.name, description: role.description, isSystem: true },
    create: {
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: true,
    },
    select: { id: true },
  });

  const permissionRows = await prisma.permission.findMany({
    where: { key: { in: role.permissions } },
    select: { id: true, key: true },
  });

  await prisma.rolePermission.deleteMany({
    where: {
      roleId: row.id,
      permissionId: { notIn: permissionRows.map((p) => p.id) },
    },
  });

  for (const permission of permissionRows) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: row.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: row.id, permissionId: permission.id },
    });
  }
}
