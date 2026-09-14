/**
 * The Recovery Kit's host-access CLI surface (D-095/D-114/D-166, §3/§4/§5).
 *
 * `backup:init-token` and `backup:create` are ordinary host-access commands
 * (same authority basis as everything in `src/cli` — see `src/cli/index.ts`'s
 * module doc). `restore` and `secret:recover` are the §4.2/§4.2.2 recovery
 * paths, run from the host on a FRESH instance (`restore`) or after a
 * fingerprint mismatch (`secret:recover`) — see `restore-service.ts` for why
 * `restore` itself re-checks the boot state rather than trusting the caller.
 *
 * NOT BUILT HERE, FLAGGED: these commands do not raise a `BreakGlassAlert`
 * banner the way `admin:create`/`admin:grant-admin` do
 * (`../break-glass.ts`'s closed `BreakGlassCommand` union does not include
 * them). `backup:create` running routinely (including automatically, §5) is
 * not break-glass in that sense; `restore` happens before any administrator
 * session could dismiss a banner anyway. `secret:recover` arguably SHOULD
 * notify administrators once the instance is back up — left as a follow-up
 * rather than extending a carefully-scoped shared union under this phase's
 * time budget.
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  createSystemBackup,
  initializeRecoveryKit,
  recoveryKitInitialized,
} from "@/modules/backup/application/backup-service";
import {
  restoreFromArchive,
  RestoreRefusedNotEmptyError,
} from "@/modules/backup/application/restore-service";
import {
  ArchiveFormatError,
  KeyFingerprintMismatchError,
  recoverSecretKeyFromArchive,
} from "@/modules/backup/domain/archive-format";
import {
  generateRecoveryToken,
  parseRecoveryToken,
} from "@/lib/crypto/recovery-token";

import type { CommandContext } from "../context";
import { readSecretFile, readSecretLine } from "../prompt";

/**
 * `backup:init-token` — generates the Recovery Kit token, prints it ONCE, and
 * persists the wrapped key record every future archive embeds (D-114). Refuses
 * to run twice (`storeWrappedKeyRecord`'s own guard, surfaced here as a clear
 * refusal rather than a stack trace).
 */
export async function backupInitToken(ctx: CommandContext): Promise<number> {
  if (recoveryKitInitialized()) {
    ctx.error(
      "A Recovery Kit token has already been generated for this instance. " +
        "Token rotation is not built yet (flagged in the phase report) — " +
        "generating a second one is refused rather than silently orphaning " +
        "the first printed token.",
    );
    return 1;
  }

  const token = generateRecoveryToken();
  initializeRecoveryKit(token.raw);

  ctx.log("");
  ctx.log("═══════════════════════════════════════════════════════════════");
  ctx.log("  RECOVERY KIT TOKEN — write this down now. It is shown ONCE.");
  ctx.log("═══════════════════════════════════════════════════════════════");
  ctx.log("");
  ctx.log(`  ${token.formatted}`);
  ctx.log("");
  ctx.log(
    "  Together with a .stbak backup file, this is what gets this " +
      "installation running again after a failure. Neither is useful " +
      "without the other (D-040). Store it somewhere durable and separate " +
      "from the backup files themselves.",
  );
  ctx.log("═══════════════════════════════════════════════════════════════");
  return 0;
}

/** Exit code `backup:create --reason pre-migration` returns when D-044's
 * `backup.premigrationEnabled` setting is off — distinct from 0 (backup
 * written) and 1 (failed), so `docker-entrypoint.sh` can tell "skipped by an
 * explicit setting" apart from "the engine failed" without parsing stderr. */
export const SKIPPED_BY_SETTING_EXIT_CODE = 3;

/**
 * `backup:create --out <path>` — §3.1's `Create backup now`, from the host.
 * No token is needed (the persisted wrap from `backup:init-token` is reused —
 * see `backup-service.ts`'s module doc).
 *
 * `--reason pre-migration` is the one caller that checks D-044's
 * `backup.premigrationEnabled` setting first (§7) — every other caller (the
 * admin UI's `backup.run`, an ordinary manual `backup:create`) is the
 * operator asking directly, which the setting has no say over.
 */
export async function backupCreate(ctx: CommandContext): Promise<number> {
  const out = ctx.flags.out ?? ctx.positionals[0];
  if (!out) {
    ctx.error("Usage: splashtrack backup:create --out <path>");
    return 2;
  }
  const reason = ctx.flags.reason ?? "manual (CLI)";

  if (reason === "pre-migration") {
    const { getPublicOrganizationConfig } = await import("@/lib/settings");
    const { config } = await getPublicOrganizationConfig();
    if (!config.backup.premigrationEnabled) {
      ctx.log(
        "Pre-migration backup skipped: backup.premigrationEnabled is off " +
          "(§7, D-044). The documentation advises against disabling this.",
      );
      return SKIPPED_BY_SETTING_EXIT_CODE;
    }
  }

  const result = await createSystemBackup(reason);
  writeFileSync(out, result.archive, { mode: 0o600 });

  ctx.log(`Wrote ${result.archive.length} bytes to ${out}.`);
  ctx.log(
    `Manifest: appVersion=${result.manifest.appVersion} ` +
      `migrations=${result.manifest.appliedMigrations.length} ` +
      `keyFingerprint=${result.manifest.keyFingerprintHex}`,
  );
  return 0;
}

/**
 * `restore --file <path> [--token-file <path>]` — §4.2/§4.4. The token is
 * read from a file when given (automation, the `resolveSecret` precedent) or
 * prompted for without echo otherwise. Refuses outright on anything but an
 * EMPTY boot state — see `restore-service.ts`.
 */
export async function restoreCommand(ctx: CommandContext): Promise<number> {
  const file = ctx.flags.file ?? ctx.positionals[0];
  if (!file) {
    ctx.error(
      "Usage: splashtrack restore --file <path.stbak> [--token-file <path>]",
    );
    return 2;
  }

  const tokenText = ctx.flags["token-file"]
    ? readSecretFile(ctx.flags["token-file"])
    : await readSecretLine("Recovery token: ");

  let token;
  try {
    token = parseRecoveryToken(tokenText);
  } catch (error) {
    ctx.error((error as Error).message);
    return 1;
  }

  const archiveBytes = readFileSync(file);

  try {
    const result = await restoreFromArchive(archiveBytes, token.raw);
    ctx.log(
      `Restore complete. ${Object.keys(result.rowCounts).length} table(s), ` +
        `manifest appVersion=${result.manifest.appVersion}.`,
    );
    for (const warning of result.warnings) ctx.log(`  warning: ${warning}`);
    return 0;
  } catch (error) {
    if (error instanceof RestoreRefusedNotEmptyError) {
      ctx.error(error.message);
      return 1;
    }
    if (error instanceof KeyFingerprintMismatchError) {
      ctx.error(error.message);
      return 1;
    }
    if (error instanceof ArchiveFormatError) {
      ctx.error(error.message);
      return 1;
    }
    throw error;
  }
}

/**
 * `secret:recover --file <path> --out <path> [--token-file <path>]` — D-166's
 * §4.2.2 recovery command: unwraps ONLY the archive's `SECRET_KEY`, given the
 * token, and writes it to `--out` at mode 0600. Prints nothing of the key
 * itself. The operator mounts the written file as `SECRET_KEY_FILE` and
 * re-runs `restore`.
 */
export async function secretRecover(ctx: CommandContext): Promise<number> {
  const file = ctx.flags.file;
  const out = ctx.flags.out;
  if (!file || !out) {
    ctx.error(
      "Usage: splashtrack secret:recover --file <path.stbak> --out <path> " +
        "[--token-file <path>]",
    );
    return 2;
  }

  const tokenText = ctx.flags["token-file"]
    ? readSecretFile(ctx.flags["token-file"])
    : await readSecretLine("Recovery token: ");

  let token;
  try {
    token = parseRecoveryToken(tokenText);
  } catch (error) {
    ctx.error((error as Error).message);
    return 1;
  }

  const archiveBytes = readFileSync(file);
  let secretKey: Buffer;
  try {
    secretKey = recoverSecretKeyFromArchive(archiveBytes, token.raw);
  } catch (error) {
    ctx.error((error as Error).message);
    return 1;
  }

  writeFileSync(out, secretKey.toString("base64"), { mode: 0o600, flag: "wx" });
  ctx.log(`Recovered SECRET_KEY written to ${out} (mode 0600).`);
  ctx.log("Mount it as SECRET_KEY_FILE and restart, then re-run restore.");
  return 0;
}
