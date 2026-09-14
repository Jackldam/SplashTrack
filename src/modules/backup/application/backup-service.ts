/**
 * On-demand backup (D-095/D-102/D-114/D-166, §3.1) and download (D-042, §3.3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `createBackup` TAKES THE RAW RECOVERY TOKEN AS AN ARGUMENT — FLAGGED,
 * BECAUSE THE DESIGN DOCUMENT DOES NOT SAY
 *
 * §3.1 describes backup as "one click" ("`Create backup now` produces one
 * `.stbak` file"). D-166 requires every archive's key record to be wrapped
 * fresh, bound as AAD to THAT archive's own manifest digest, under the
 * recovery token's raw entropy (§2.3: "the record is bound as AAD to the
 * archive's manifest digest, so it cannot be spliced from one archive into
 * another"). Those two requirements are in tension, and the design does not
 * resolve it: a literal one-click button needs the raw token available to the
 * server at the moment of the click, and the ONLY way for that to be true
 * without asking the operator every time is for the application to hold the
 * token (or something that reconstructs it) at rest — which is precisely what
 * D-114 §2.1's whole argument against making the token double as key material
 * is about, one layer up: whoever can make the server wrap a key record without
 * the operator's involvement has, in effect, the token's power without the
 * operator's paper.
 *
 * This implementation resolves the tension in the direction that keeps
 * D-114/D-166's security property intact rather than the one-click phrasing
 * literal: the admin UI's "Create backup now" form asks for the recovery
 * token alongside the button. The token is used for exactly one archive build
 * and is never persisted, logged, or cached — `Buffer` inputs are the
 * caller's, and nothing here writes them anywhere but the archive.
 *
 * FLAGGED FOR JACK: the alternative — storing the ARGON2ID-WRAPPED key record
 * once (at setup) and re-embedding that SAME wrap, unchanged, into every
 * archive's header (dropping the per-archive AAD binding to a fixed
 * per-instance constant instead) — would restore true one-click backups at the
 * cost of weakening D-166's anti-splicing property to "harmless splicing
 * within one instance's own archives" (still no cross-instance leak, since the
 * wrap's plaintext is instance-invariant either way). That is a genuine design
 * choice between two real trade-offs and this build did not make it
 * unilaterally; it takes the token-required path because it is the one that
 * matches D-114's stated security model without a design amendment.
 */

import { APP_VERSION } from "@/lib/app-version";
import type { Principal } from "@/lib/authorization";
import { requirePermission } from "@/lib/authorization";
import { computeKeyFingerprint } from "@/lib/crypto/backup-envelope";
import { deriveKey, loadBootstrapSecret } from "@/lib/crypto/secret-key";
import type { DatabaseClient } from "@/lib/database";
import { prisma } from "@/lib/database";
import { recordAuditEvent, recordAuditEventSafe } from "@/modules/audit";

import { buildArchive, type ArchiveManifest } from "../domain/archive-format";
import {
  encodeExportPayload,
  exportDatabase,
} from "../infrastructure/logical-export";

async function readAppliedMigrations(client: DatabaseClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`,
  );
  return rows.map((r) => r.migration_name);
}

export interface CreateBackupInput {
  readonly principal: Principal;
  /** The recovery token's raw entropy (D-115) — see the module doc for why
   * this is required on every call rather than stored. Never logged. */
  readonly tokenRaw: Buffer;
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
 * exfiltration (the caller still has to download it — D-042, `retrieveBackup`
 * below), but it is the action that makes exfiltration possible with nothing
 * further than access to whatever the caller does with the returned bytes, so
 * it is recorded with the same weight `backup.download` gets.
 */
export async function createBackup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  const at = input.at ?? new Date();
  await requirePermission(input.principal, "backup.run", { organization: true }, { at });

  const client = prisma;
  const secretKey = loadBootstrapSecret();
  const masterKey = deriveKey("backup-master-v1");

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
    secretKey,
    tokenRaw: input.tokenRaw,
  });

  const filename = `splashtrack-backup-${at
    .toISOString()
    .replace(/[:.]/g, "")
    .replace("Z", "Z")}.stbak`;

  await recordAuditEventSafe({
    eventType: "backup.created",
    outcome: "SUCCESS",
    actorPersonId: input.principal.personId,
    actorAuthMethod: "session",
    targetType: "backup",
    targetId: null,
    requestId: input.requestId ?? null,
    changedFields: {
      sizeBytes: archive.length,
      keyFingerprint: computeKeyFingerprint(secretKey).toString("hex"),
    },
  });

  return {
    archive,
    manifest: { ...manifestInput, keyFingerprintHex: computeKeyFingerprint(secretKey).toString("hex") },
    filename,
  };
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
  await requirePermission(input.principal, "backup.download", { organization: true }, { at });

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
