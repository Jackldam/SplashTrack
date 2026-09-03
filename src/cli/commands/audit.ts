/**
 * `audit:verify` and `audit:grants`.
 *
 * `audit:verify` is D-149 part 1 on the image, reporting in D-168's shape —
 * "intact across N pruned segments". `scripts/audit-verify.ts` delegates here so
 * there is one implementation rather than a script and a binary that drift.
 *
 * `audit:grants` is the OTHER half of D-149 part 2, and it exists because a
 * grant nobody checks is a grant nobody has. `infra/audit-database-role.sql` is
 * run by an operator against a privileged role; this command reads
 * `information_schema.table_privileges` through the application's own connection
 * and prints what is actually true — which is the only way an operator learns
 * that the SQL ran, ran against the right database, and named the right role.
 * Reading privileges needs no privilege, so this works from the app's
 * non-superuser role (D-116).
 */

import { prisma } from "@/lib/database";

import type { CommandContext } from "../context";

export async function auditVerify(ctx: CommandContext): Promise<number> {
  const { pruneAuditTrail, verifyAuditChain } = await import("@/modules/audit");

  const pruneBefore = ctx.flags["prune-before"];
  if (pruneBefore) {
    const cutoff = new Date(pruneBefore);
    if (Number.isNaN(cutoff.getTime())) {
      ctx.error(`--prune-before is not a date: "${pruneBefore}"`);
      return 2;
    }
    const outcome = await pruneAuditTrail(
      cutoff,
      ctx.flags.reason ?? "manual_retention_run",
    );
    ctx.log(
      outcome.prunedCount === 0
        ? `Retention: nothing had expired before ${cutoff.toISOString()}.`
        : `Retention: pruned ${outcome.prunedCount} event(s), sequences ` +
            `${outcome.prunedFromSequence}–${outcome.prunedToSequence}, ` +
            `behind checkpoint ${outcome.checkpointId}.`,
    );
  }

  const result = await verifyAuditChain();
  if (result.valid) {
    ctx.log(
      `Audit chain intact across ${result.prunedSegments} pruned segment(s); ` +
        `${result.count} event(s) verified.`,
    );
    return 0;
  }

  ctx.error("AUDIT CHAIN BROKEN.");
  ctx.error(`  ${result.failure ?? "no detail"}`);
  if (result.brokenAtSequence !== undefined) {
    ctx.error(`  First bad event sequence: ${result.brokenAtSequence}`);
  }
  if (result.brokenCheckpointSequence !== undefined) {
    ctx.error(`  Checkpoint at sequence: ${result.brokenCheckpointSequence}`);
  }
  ctx.error(`  Pruned segments recorded: ${result.prunedSegments}`);
  return 1;
}

interface GrantRow {
  grantee: string;
  table_name: string;
  privilege_type: string;
}

/**
 * Prints the grants that actually exist on `AuditEvent` and `AuditCheckpoint`,
 * and says plainly whether the D-149 separation is in force.
 *
 * Exit code 0 whether or not the role exists: this is a REPORT, and the
 * entrypoint must not refuse to start an instance because a deployment step the
 * operator owns has not been run yet. It is loud instead — the diagnostics page
 * carries the same line when it exists (`13-…` §8).
 */
export async function auditGrants(ctx: CommandContext): Promise<number> {
  // "No grants found" and "the table does not exist yet" produce the same empty
  // result set, and reporting the second as "the separation is in force" would
  // be a green light on an installation that has not been migrated. Ask first.
  const present = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'AuditEvent'
    ) AS present
  `;
  if (present[0]?.present !== true) {
    ctx.log(
      "The audit tables do not exist yet — this installation has not been " +
        "migrated. Nothing to report; run this again after setup.",
    );
    return 0;
  }

  const rows = await prisma.$queryRaw<GrantRow[]>`
    SELECT grantee, table_name, privilege_type
      FROM information_schema.table_privileges
     WHERE table_name IN ('AuditEvent', 'AuditCheckpoint')
     ORDER BY table_name, grantee, privilege_type
  `;

  const current = await prisma.$queryRaw<{ role: string }[]>`
    SELECT current_user AS role
  `;
  const appRole = current[0]?.role ?? "unknown";

  ctx.log(`Application database role: ${appRole}`);
  ctx.log("");
  ctx.log("Grants on the audit tables:");
  if (rows.length === 0) {
    ctx.log("  (none visible to this role)");
  }
  for (const row of rows) {
    ctx.log(`  ${row.table_name.padEnd(16)} ${row.grantee.padEnd(28)} ${row.privilege_type}`);
  }

  const appWrites = rows.filter(
    (row) =>
      row.grantee === appRole &&
      row.table_name === "AuditEvent" &&
      (row.privilege_type === "UPDATE" || row.privilege_type === "DELETE"),
  );

  ctx.log("");
  if (appWrites.length === 0) {
    ctx.log(
      "D-149 part 2 is IN FORCE: the application role holds neither UPDATE " +
        "nor DELETE on AuditEvent.",
    );
  } else {
    ctx.log(
      "D-149 part 2 is NOT in force: the application role still holds " +
        `${appWrites.map((row) => row.privilege_type).join(" and ")} on ` +
        "AuditEvent. Append-only currently rests on the audit repository " +
        "being the only writer and exposing no mutation, which is a code " +
        "property rather than a database one. Apply " +
        "infra/audit-database-role.sql as a privileged role — see the header " +
        "of that file for why this is a deployment step and not a migration.",
    );
  }
  return 0;
}
