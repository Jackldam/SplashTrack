/**
 * The diagnostics page's data (R-21, `13-configuration-and-setup.md` §8).
 *
 * "Borrowed directly from Vaultwarden": one screen, safe to paste into a
 * public GitHub issue — no secrets, no personal data (F-20) — showing
 * effective configuration + provenance, database connectivity, migration
 * state, backup posture, version, and advisory status. Gated on
 * `diagnostics.read` at `ORGANIZATION` scope by the CALLER (the page), never
 * served unauthenticated (D-156) — this function does not gate itself, same
 * convention as `getEffectiveSettings`.
 *
 * WHAT §8 ASKS FOR AND THIS PHASE DOES NOT BUILD, FLAGGED RATHER THAN FAKED:
 *   - An email TEST-SEND result — no SMTP sending exists yet (see the phase
 *     report; `email.smtpHost`/`email.smtpPassword` are registry entries with
 *     nothing behind them that sends mail).
 *   - "Whether a newer release with a security advisory exists" (D-034) — no
 *     update-check mechanism exists (`@/lib/settings/config.ts`'s own v3 note:
 *     "`update.check.enabled` ... neither of which is built this phase" still
 *     holds). Reported as `"not implemented"` rather than a fabricated `false`.
 *   - Whether any encrypted column holds ciphertext under a superseded
 *     `keyId` — `key:rotate` does not exist yet (only one key generation, "1",
 *     has ever existed), so the answer is trivially "none", stated as such
 *     rather than computed from a rotation history that cannot happen yet.
 *   - The key-custody fingerprint-match check against the newest archive
 *     (D-166) — no backup-history table exists to name "the newest archive"
 *     from (phase 3.0's own report: no scheduled backups, no persisted
 *     history). Reported as `"not tracked"`.
 */

import { detectBootState, type BootDecision } from "@/lib/boot";
import { describeSecretKeySource } from "@/lib/crypto";
import { prisma } from "@/lib/database";

import { APP_VERSION } from "@/lib/app-version";
import { recoveryKitInitialized } from "@/modules/backup";
import { verifyAuditChain, type AuditChainVerification } from "@/modules/audit";

import {
  getEffectiveSettings,
  type EffectiveSetting,
} from "./settings-service";
import { evaluateLockoutInvariant } from "./lockout-invariant-service";
import type { LockoutInvariantCheck } from "../domain/lockout-invariant";

export interface DiagnosticsReport {
  readonly version: string;
  readonly generatedAt: string;
  readonly database: { readonly connected: boolean; readonly detail?: string };
  readonly migrations: {
    readonly state: BootDecision["state"];
    readonly pendingMigrations: readonly string[];
    readonly unknownMigrations: readonly string[];
  };
  readonly effectiveSettings: readonly EffectiveSetting[];
  readonly lockoutInvariant: LockoutInvariantCheck;
  readonly auditChain: AuditChainVerification;
  readonly recoveryKit: {
    readonly initialized: boolean;
    readonly lastBackupAge: "not tracked";
  };
  readonly secretKey: {
    readonly source: "file" | "environment" | "unknown";
    /** True ⇒ the deprecated plain-`SECRET_KEY` path is in use (§3.1.1 warns). */
    readonly deprecatedEnvironmentWarning: boolean;
  };
  /** §8's "container logs and $DATA_DIR may contain a live setup token" line. */
  readonly setupTokenWarning: string;
  readonly advisoryStatus: "not implemented";
  readonly supersededKeyColumns: "none — only one key generation has ever existed";
}

async function checkDatabase(): Promise<{
  connected: boolean;
  detail?: string;
}> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true };
  } catch (error) {
    return {
      connected: false,
      detail: error instanceof Error ? error.message : "unreachable",
    };
  }
}

export async function buildDiagnosticsReport(): Promise<DiagnosticsReport> {
  const [
    database,
    migrationState,
    effectiveSettings,
    lockoutInvariant,
    auditChain,
  ] = await Promise.all([
    checkDatabase(),
    detectBootState(),
    getEffectiveSettings(),
    evaluateLockoutInvariant(),
    verifyAuditChain(),
  ]);

  const secretKeySource = describeSecretKeySource();

  return {
    version: APP_VERSION,
    generatedAt: new Date().toISOString(),
    database,
    migrations: {
      state: migrationState.state,
      pendingMigrations: migrationState.pendingMigrations,
      unknownMigrations: migrationState.unknownMigrations,
    },
    effectiveSettings,
    lockoutInvariant,
    auditChain,
    recoveryKit: {
      initialized: recoveryKitInitialized(),
      lastBackupAge: "not tracked",
    },
    secretKey: {
      source: secretKeySource?.kind ?? "unknown",
      deprecatedEnvironmentWarning: secretKeySource?.deprecated ?? false,
    },
    setupTokenWarning:
      "Container logs and $DATA_DIR may contain a live setup token. Never " +
      "paste either into a support issue.",
    advisoryStatus: "not implemented",
    supersededKeyColumns: "none — only one key generation has ever existed",
  };
}
