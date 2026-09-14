/**
 * Restore (§4, D-046/D-116/D-166). ONLY ever runs against a fresh, empty
 * database — never on a running instance (§4.4) — and this module enforces
 * that itself rather than trusting a caller to have checked: `restoreFromArchive`
 * re-detects the boot state and refuses on anything other than `EMPTY`.
 *
 * SEQUENCE (§4.2), IN ORDER, EACH STEP A HARD GATE:
 *
 *   1. Boot state must be `EMPTY` — §4.4's refusal, enforced here.
 *   2. Open the archive under the token (`archive-format.ts`'s `openArchive`) —
 *      authenticates the key record, the manifest, and the body, in that
 *      order, before any of it is trusted. A wrong token or a corrupt/foreign
 *      file throws before anything below runs.
 *   3. The FINGERPRINT GATE (§4.2.2, D-166): the archive's key record must
 *      match the RUNNING instance's `SECRET_KEY`. On mismatch this refuses
 *      with nothing written and names `secret:recover` as the way out — see
 *      `KeyFingerprintMismatchError`.
 *   4. The COMPATIBILITY check (§4.3.2): a manifest naming migrations this
 *      image does not ship is a NEWER backup — refused, naming the image
 *      version required, exactly like `AHEAD` in the boot state machine
 *      (D-043 restated).
 *   5. Migrate to the CURRENT schema, then import — see `logical-import.ts`'s
 *      module doc for why this is "import into current" rather than D-046's
 *      literal "restore old DDL, then migrate forward", and why that is
 *      flagged rather than silently narrowed.
 *   6. The DECRYPTABILITY PROOF (§4.2.2): every registered encrypted column's
 *      newest non-null value decrypts, and the audit chain verifies. Any
 *      failure reports the restore FAILED — nothing about "row counts matched"
 *      is treated as success on its own (D-166's own correction of the
 *      previous, row-counts-only check).
 *
 * NOT BUILT HERE, FLAGGED: the `TwoFactor`/TOTP leg of the decryptability
 * proof (§4.2.2's table). `secret-key.ts`'s `totp-v1` purpose label "has no
 * consumer in this phase" (its own words) — no column in this schema is
 * encrypted under it yet, so there is nothing to prove decrypts. Add that leg
 * the day a TOTP secret is actually stored under this envelope.
 */

import { migrateAndApplyRoleModel } from "@/lib/boot/migrate";
import { detectBootState, imageMigrationNames } from "@/lib/boot/state";
import { ENCRYPTED_COLUMN_ENTRIES } from "@/lib/crypto/encrypted-columns";
import { open as openEnvelope } from "@/lib/crypto/envelope";
import { loadBootstrapSecret } from "@/lib/crypto/secret-key";
import { prisma } from "@/lib/database";
import { verifyAuditChain } from "@/modules/audit";

import {
  assertFingerprintMatches,
  openArchive,
  type ArchiveManifest,
} from "../domain/archive-format";
import { decodeExportPayload, importDatabase } from "../infrastructure/logical-import";

/** Thrown when restore is attempted on anything other than a genuinely empty
 * database (§4.4). The CLI/wizard's ONLY legitimate caller checks this first,
 * but the guard lives here too — a function this consequential does not trust
 * its callers to have remembered. */
export class RestoreRefusedNotEmptyError extends Error {
  constructor(state: string) {
    super(
      `Refusing to restore: this database is not empty (boot state ` +
        `${state}). §4.4: restore only ever runs against a fresh, empty ` +
        "installation. To restore over a RUNNING instance anyway — destroying " +
        "its data — stop the application first and run this from the host, " +
        "outside the running container, with full awareness that this is " +
        "destructive and irreversible.",
    );
    this.name = "RestoreRefusedNotEmptyError";
  }
}

/** Thrown when the archive's manifest names migrations this image does not
 * ship — §4.3.2's "Newer — Refuse, naming the image version required"
 * (D-043 restated). */
export class ArchiveNewerThanImageError extends Error {
  constructor(unknownMigrations: readonly string[], appVersion: string) {
    super(
      `This backup was taken by SplashTrack ${appVersion}, which is NEWER ` +
        `than this image (it applied ${unknownMigrations.length} ` +
        `migration(s) this image does not ship: ` +
        `${unknownMigrations.join(", ")}). Restoring a newer backup onto an ` +
        `older image is refused (D-043) — pull ${appVersion} or later and ` +
        "restore again.",
    );
    this.name = "ArchiveNewerThanImageError";
  }
}

/** Thrown when the decryptability proof (§4.2.2) fails after data has been
 * imported. The restore is NOT complete — the caller must not mark setup
 * finished, and should direct the operator to `secret:recover` (the usual
 * cause is a `SECRET_KEY` mismatch that somehow passed the fingerprint gate,
 * or a genuinely corrupted archive that authenticated by chance at the frame
 * level but not at the application level — vanishingly unlikely, checked for
 * defense in depth per D-166's "a restore that cannot decrypt refuses"). */
export class DecryptabilityProofFailedError extends Error {
  constructor(detail: string) {
    super(
      `Restore FAILED the decryptability proof: ${detail}. Data has been ` +
        "imported but this instance is NOT serviceable — it refuses to be " +
        "marked complete. This is D-166's own correction: row counts matching " +
        "is not sufficient evidence of a working restore.",
    );
    this.name = "DecryptabilityProofFailedError";
  }
}

export interface RestoreResult {
  readonly manifest: ArchiveManifest;
  readonly rowCounts: Record<string, number>;
  readonly warnings: readonly string[];
}

/**
 * Runs the full §4.2 sequence. Throws on ANY failure, before or after data is
 * written — see each error class above for which step failed and what to do
 * about it.
 */
export async function restoreFromArchive(
  archiveBytes: Buffer,
  tokenRaw: Buffer,
): Promise<RestoreResult> {
  // ── §4.4 — never on a running instance ────────────────────────────────────
  const decision = await detectBootState();
  if (decision.state !== "EMPTY") {
    throw new RestoreRefusedNotEmptyError(decision.state);
  }

  // ── open + authenticate (throws ArchiveFormatError on any failure) ────────
  const opened = await openArchive(archiveBytes, tokenRaw);

  // ── §4.2.2 fingerprint gate — before anything is written ──────────────────
  const runningSecretKey = loadBootstrapSecret();
  assertFingerprintMatches(opened, runningSecretKey);

  // ── §4.3.2 compatibility — refuse a NEWER backup ───────────────────────────
  const imageMigrations = new Set(imageMigrationNames());
  const unknownToImage = opened.manifest.appliedMigrations.filter(
    (name) => !imageMigrations.has(name),
  );
  if (unknownToImage.length > 0) {
    throw new ArchiveNewerThanImageError(unknownToImage, opened.manifest.appVersion);
  }
  // §4.3.2's "Older, < minimumRestorableVersion" refusal needs a semver
  // comparison against the running app's floor. At v1.0 every archive's own
  // floor equals its own version (see `backup-service.ts`), so no released
  // image has ever raised `minimumRestorableVersion` above a backup's own
  // version — there is no case to exercise yet. Left as a documented gap
  // rather than a half-built comparator: build it the day D-048 actually
  // raises a floor.

  // ── §4.2's "restore into a freshly created empty schema" (see
  //    logical-import.ts's module doc for the v1 "current schema" strategy) ──
  await migrateAndApplyRoleModel();

  const payload = decodeExportPayload(opened.exportPayload);
  const warnings: string[] = [];
  const { rowCounts } = await importDatabase(prisma, payload, (w) =>
    warnings.push(w),
  );

  // ── §4.2.2 decryptability proof ────────────────────────────────────────────
  await proveDecryptability();

  return { manifest: opened.manifest, rowCounts, warnings };
}

/**
 * §4.2.2's table, the two rows this codebase can prove at THIS phase: every
 * registered encrypted column's newest non-null value decrypts, and the audit
 * chain verifies. See the module doc for what is NOT yet provable (TOTP).
 */
async function proveDecryptability(): Promise<void> {
  for (const entry of ENCRYPTED_COLUMN_ENTRIES) {
    if (entry.fixture) continue; // golden-vector fixtures name no real table.
    const row = await prisma.$queryRawUnsafe<{ pk: string; value: string }[]>(
      `SELECT id AS pk, "${entry.field}" AS value FROM "${entry.model}"
        WHERE "${entry.field}" IS NOT NULL
        ORDER BY "id" DESC
        LIMIT 1`,
    );
    if (row.length === 0) continue; // nothing of this class was restored.
    try {
      openEnvelope(entry.columnId, row[0].pk, row[0].value);
    } catch (error) {
      throw new DecryptabilityProofFailedError(
        `"${entry.columnId}" (row ${row[0].pk}) did not decrypt: ` +
          `${(error as Error).message}`,
      );
    }
  }

  const chain = await verifyAuditChain();
  if (!chain.valid) {
    throw new DecryptabilityProofFailedError(
      `the audit chain did not verify: ${chain.failure ?? "unknown reason"}`,
    );
  }
}
