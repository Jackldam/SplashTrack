/**
 * On-demand backup (D-095/D-102/D-114/D-166, §3.1), backup initialization
 * (D-114), and download (D-042, §3.3).
 *
 * `initializeRecoveryKit` is the ONE place the raw recovery token is needed to
 * WRITE anything: it wraps the key record once (see `../domain/archive-format.ts`'s
 * "wrapped once, not per archive" section) and persists the wrap via
 * `../infrastructure/key-record-store.ts`. Every backup after that —
 * on-demand (`createBackup`) or automatic (`createSystemBackup`, §5) — reads
 * the stored wrap and needs no token at all, which is what makes both an
 * admin-UI "Create backup now" button and an unattended pre-migration backup
 * actually buildable.
 */

import { APP_VERSION } from "@/lib/app-version";
import type { Principal } from "@/lib/authorization";
import { requirePermission } from "@/lib/authorization";
import { deriveKey, loadBootstrapSecret } from "@/lib/crypto/secret-key";
import type { DatabaseClient } from "@/lib/database";
import { prisma } from "@/lib/database";
import { recordAuditEvent, recordAuditEventSafe } from "@/modules/audit";

import {
  buildArchive,
  generateWrappedKeyRecord,
  type ArchiveManifest,
} from "../domain/archive-format";
import {
  encodeExportPayload,
  exportDatabase,
} from "../infrastructure/logical-export";
import {
  hasWrappedKeyRecord,
  readWrappedKeyRecord,
  storeWrappedKeyRecord,
} from "../infrastructure/key-record-store";

async function readAppliedMigrations(
  client: DatabaseClient,
): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}

/**
 * Generates and PERSISTS the wrapped key record (D-114) — the one-time step
 * before any backup can be taken. Run once, from `setup:init` or an explicit
 * admin action ("Set up the Recovery Kit"); refuses to overwrite an existing
 * wrap (`storeWrappedKeyRecord`'s own guard).
 */
export async function initializeRecoveryKit(tokenRaw: Buffer): Promise<void> {
  const secretKey = loadBootstrapSecret();
  const masterKey = deriveKey("backup-master-v1");
  const wrapped = await generateWrappedKeyRecord(
    tokenRaw,
    secretKey,
    masterKey,
  );
  storeWrappedKeyRecord(wrapped);
}

/** Whether the Recovery Kit has been initialized — diagnostics-page / wizard
 * check (§2.2's "recovery token acknowledged: yes/no"). */
export function recoveryKitInitialized(): boolean {
  return hasWrappedKeyRecord();
}

/** The part `createBackup` (admin UI) and `createSystemBackup` (CLI /
 * pre-migration, §5) share: build the archive itself. Neither permission
 * checking nor audit recording happens here — each caller does its OWN,
 * because they audit under different actors (a real principal vs.
 * `system:cli`/a scheduled action) and that distinction must never blur. */
async function buildBackupArchive(
  at: Date,
): Promise<{ archive: Buffer; manifest: ArchiveManifest; filename: string }> {
  const client = prisma;
  const masterKey = deriveKey("backup-master-v1");
  const wrappedKeyRecord = readWrappedKeyRecord();

  const { payload, rowCounts } = await exportDatabase(client);
  const appliedMigrations = await readAppliedMigrations(client);
  const appVersion = APP_VERSION;

  const manifestInput: Omit<ArchiveManifest, "keyFingerprintHex"> = {
    archiveFormatVersion: 1,
    appVersion,
    appliedMigrations,
    minimumRestorableVersion: appVersion,
    createdAt: at.toISOString(),
    rowCounts,
  };

  const archive = buildArchive({
    manifest: manifestInput,
    exportPayload: encodeExportPayload(payload),
    masterKey,
    wrappedKeyRecord,
  });

  const filename = `splashtrack-backup-${at.toISOString().replace(/[:.]/g, "")}.stbak`;

  return {
    archive,
    manifest: {
      ...manifestInput,
      keyFingerprintHex: wrappedKeyRecord.keyFingerprint.toString("hex"),
    },
    filename,
  };
}

export interface CreateBackupInput {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

export interface CreateBackupResult {
  readonly archive: Buffer;
  readonly manifest: ArchiveManifest;
  readonly filename: string;
}

/**
 * §3.1 — `backup.run`. Builds one `.stbak` archive and returns it in memory
 * (see `../../../lib/crypto/framed-aead.ts` for the in-memory trade-off,
 * stated once). Audited at HIGH severity: taking a backup is not itself an
 * exfiltration (the caller still has to download it — D-042,
 * `requireBackupDownload` below), but it is the action that makes
 * exfiltration possible with nothing further than access to whatever the
 * caller does with the returned bytes, so it is recorded with the same
 * weight `backup.download` gets.
 */
export async function createBackup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  const at = input.at ?? new Date();
  await requirePermission(
    input.principal,
    "backup.run",
    { organization: true },
    { at },
  );

  const result = await buildBackupArchive(at);

  await recordAuditEventSafe({
    eventType: "backup.created",
    outcome: "SUCCESS",
    actorPersonId: input.principal.personId,
    actorAuthMethod: "session",
    targetType: "backup",
    targetId: null,
    requestId: input.requestId ?? null,
    changedFields: {
      sizeBytes: result.archive.length,
      keyFingerprint: result.manifest.keyFingerprintHex,
    },
  });

  return result;
}

/**
 * The CLI / boot-state path (§5, D-044) — no `requirePermission` call, on the
 * same "host access is authority" basis every other `src/cli` command runs
 * on (see `src/cli/index.ts`'s module doc): there is no HTTP principal at
 * container start, and a pre-migration backup that refused to run without one
 * would simply never run. Audited with `actorPersonId: null` —
 * `AuditEventInput`'s own doc comment: "null/omitted for a system/scheduled
 * action".
 */
export async function createSystemBackup(
  reason: string,
  at: Date = new Date(),
): Promise<CreateBackupResult> {
  const result = await buildBackupArchive(at);

  await recordAuditEventSafe({
    eventType: "backup.created",
    outcome: "SUCCESS",
    actorPersonId: null,
    actorAuthMethod: "system:cli",
    targetType: "backup",
    targetId: null,
    changedFields: {
      sizeBytes: result.archive.length,
      keyFingerprint: result.manifest.keyFingerprintHex,
      reason,
    },
  });

  return result;
}

export interface RecordBackupDownloadInput {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

/**
 * §3.3 (D-042) — `backup.download`. The download button is, in the design's
 * own words, "the single most dangerous UI element in the application" — a
 * one-click complete personal-data exfiltration primitive. This records the
 * audit event at HIGH severity (`recordAuditEvent`, throwing, so a failed
 * audit append blocks the disclosure rather than silently allowing it —
 * `recordAuditEvent`'s own doc comment names exactly this class of action).
 *
 * NOT BUILT HERE, FLAGGED (§3.3, D-042): step-up re-authentication, rate
 * limiting, and serving via a short-lived single-use SIGNED LINK rather than a
 * direct response. This codebase has no step-up-reauthentication primitive and
 * no signed-URL mechanism yet (checked: `@/lib/auth` has session verification
 * only), and building either is real infrastructure work beyond one backup
 * screen. The permission check and the audit event are real and enforced;
 * the additional D-042 controls are a flagged follow-up, not silently
 * skipped — see the phase report.
 */
export async function requireBackupDownload(
  input: RecordBackupDownloadInput,
): Promise<void> {
  const at = input.at ?? new Date();
  await requirePermission(
    input.principal,
    "backup.download",
    { organization: true },
    { at },
  );

  await recordAuditEvent({
    eventType: "backup.downloaded",
    outcome: "SUCCESS",
    actorPersonId: input.principal.personId,
    actorAuthMethod: "session",
    targetType: "backup",
    targetId: null,
    requestId: input.requestId ?? null,
  });
}
