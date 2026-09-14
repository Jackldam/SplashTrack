/**
 * Scope-escape for the Recovery Kit's `backup.run` / `backup.download`
 * (D-030/D-042): does `createBackup`/`requireBackupDownload` actually refuse a
 * principal who holds neither permission, and allow one who does? Both are
 * `{ organization: true }`-scoped (§3's backup module has nothing narrower to
 * name — an archive is the whole instance), so no `ScopeRelations` fixtures
 * are needed; a real `Person` + `Role` + `RoleAssignment` is sufficient.
 *
 * `createBackup` additionally exercises the real export engine end to end
 * against the suite's own `_test` database, which is a meaningful backup
 * target in its own right (unlike the throwaway-database round trip in
 * `logical-export-import-roundtrip.test.ts`, this proves the permission gate
 * sits IN FRONT of the export, not merely beside it).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { generateRecoveryToken } from "@/lib/crypto/recovery-token";
import { prisma } from "@/lib/database";
import { openArchive } from "@/modules/backup/domain/archive-format";
import {
  createBackup,
  initializeRecoveryKit,
  requireBackupDownload,
} from "@/modules/backup/application/backup-service";

const PREFIX = "esc_backup_";

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

async function makeRoleWithPermissions(
  suffix: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = id(suffix);
  await prisma.role.create({ data: { id: roleId, key: roleId, name: suffix } });
  for (const key of permissions) {
    const permissionId = id(`perm_${key.replace(/\./g, "_")}`);
    await prisma.permission.upsert({
      where: { id: permissionId },
      update: {},
      create: { id: permissionId, key },
    });
    await prisma.rolePermission.create({ data: { roleId, permissionId } });
  }
  return roleId;
}

async function grantOrganization(
  personId: string,
  roleId: string,
): Promise<void> {
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

// `initializeRecoveryKit`/`createBackup` read $DATA_DIR for the persisted
// wrapped key record (see key-record-store.ts) — a fresh temp directory per
// test so tests never collide with each other or with the worktree's own
// `data/`.
let originalDataDir: string | undefined;
let tempDataDir: string;

beforeEach(async () => {
  await cleanup();
  originalDataDir = process.env.DATA_DIR;
  tempDataDir = mkdtempSync(path.join(tmpdir(), "splashtrack-backup-test-"));
  process.env.DATA_DIR = tempDataDir;
});
afterEach(async () => {
  await cleanup();
  process.env.DATA_DIR = originalDataDir;
  rmSync(tempDataDir, { recursive: true, force: true });
});

describe("backup.run / backup.download scope escape (D-030/D-042)", () => {
  it("refuses createBackup to a principal holding neither permission", async () => {
    const bystanderId = await makePerson("bystander");

    await expect(
      createBackup({ principal: { personId: bystanderId } }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("refuses createBackup to a principal holding only backup.download", async () => {
    const personId = await makePerson("downloader_only");
    const roleId = await makeRoleWithPermissions("role_download_only", [
      "backup.download",
    ]);
    await grantOrganization(personId, roleId);

    await expect(createBackup({ principal: { personId } })).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it("allows createBackup to a principal holding backup.run, and the archive opens under the same token", async () => {
    const personId = await makePerson("operator");
    const roleId = await makeRoleWithPermissions("role_backup_run", [
      "backup.run",
    ]);
    await grantOrganization(personId, roleId);
    const token = generateRecoveryToken();
    initializeRecoveryKit(token.raw);

    const result = await createBackup({ principal: { personId } });

    expect(result.archive.length).toBeGreaterThan(0);
    expect(result.filename).toMatch(/^splashtrack-backup-.*\.stbak$/);

    const opened = openArchive(result.archive, token.raw);
    expect(opened.manifest.rowCounts.Organization).toBeGreaterThanOrEqual(0);
  });

  it("refuses requireBackupDownload to a principal without backup.download", async () => {
    const personId = await makePerson("no_download");
    const roleId = await makeRoleWithPermissions("role_run_only", [
      "backup.run",
    ]);
    await grantOrganization(personId, roleId);

    await expect(
      requireBackupDownload({ principal: { personId } }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("allows requireBackupDownload to a principal holding backup.download", async () => {
    const personId = await makePerson("downloader");
    const roleId = await makeRoleWithPermissions("role_download", [
      "backup.download",
    ]);
    await grantOrganization(personId, roleId);

    await expect(
      requireBackupDownload({ principal: { personId } }),
    ).resolves.toBeUndefined();
  });
});
