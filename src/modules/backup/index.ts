/**
 * Backup module public API (D-095/D-102/D-114/D-166, `13-…` §7, `14-…`).
 *
 * ADDED IN PHASE 3.2 — the module had no `index.ts` before this phase because
 * every existing caller (`src/app/api/admin/backup/route.ts`,
 * `src/cli/commands/backup.ts`) sits OUTSIDE `src/modules/**`, where the
 * module-boundary ESLint rule (`eslint.config.mjs`) does not apply. The
 * settings module's diagnostics report is the first caller reaching this
 * module FROM ANOTHER MODULE (`@/modules/settings` needs
 * `recoveryKitInitialized` for `13-…` §8's "recovery token acknowledged"
 * line), and the rule requires that to go through a published surface — so
 * this file is that surface, not a single-purpose shim.
 */

export {
  createBackup,
  createSystemBackup,
  initializeRecoveryKit,
  recoveryKitInitialized,
  requireBackupDownload,
  type CreateBackupInput,
  type CreateBackupResult,
  type RecordBackupDownloadInput,
} from "./application/backup-service";

export {
  ArchiveNewerThanImageError,
  DecryptabilityProofFailedError,
  RestoreRefusedNotEmptyError,
  restoreFromArchive,
  type RestoreResult,
} from "./application/restore-service";
