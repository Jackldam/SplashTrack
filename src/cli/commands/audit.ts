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

interface OwnerRow {
  table_name: string;
  owner: string;
}

/**
 * Prints the grants that actually exist on `AuditEvent` and `AuditCheckpoint`,
 * the OWNER of each, and says plainly whether the D-149 separation is in force.
 *
 * WHY THE OWNER IS PART OF THE REPORT AND NOT A DETAIL. A table's owner holds
 * its privileges by ownership rather than by grant, and may re-grant them to
 * itself at any moment. `REVOKE DELETE … FROM <owner>` therefore stops exactly
 * one statement. Measured on postgres:16-alpine, as the owning role:
 *
 *     REVOKE DELETE ON "AuditEvent" FROM app;
 *     SET ROLE app; DELETE FROM "AuditEvent";           -- permission denied  ✓
 *     SET ROLE app; GRANT DELETE ON "AuditEvent" TO app;
 *                   DELETE FROM "AuditEvent";           -- DELETE 1           ✗
 *
 * The actor D-149 part 2 names is an external SQL primitive, and a primitive
 * that can issue `DELETE` can generally issue `GRANT`. So an empty grant list
 * over a table the application role OWNS is not the separation — and printing
 * "IN FORCE" for it would make this report wrong in the reassuring direction,
 * which is worse than not having it. See ADR-0002.
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

  const owners = await prisma.$queryRaw<OwnerRow[]>`
    SELECT tablename AS table_name, tableowner AS owner
      FROM pg_tables
     WHERE schemaname = current_schema()
       AND tablename IN ('AuditEvent', 'AuditCheckpoint')
     ORDER BY tablename
  `;

  const current = await prisma.$queryRaw<{ role: string }[]>`
    SELECT current_user AS role
  `;
  const appRole = current[0]?.role ?? "unknown";

  ctx.log(`Application database role: ${appRole}`);
  ctx.log("");
  ctx.log("Owner of the audit tables:");
  for (const row of owners) {
    ctx.log(
      `  ${row.table_name.padEnd(16)} ${row.owner}` +
        (row.owner === appRole ? "   ← the application's own role" : ""),
    );
  }
  ctx.log("");
  ctx.log("Grants on the audit tables:");
  if (rows.length === 0) {
    ctx.log("  (none visible to this role)");
  }
  for (const row of rows) {
    ctx.log(
      `  ${row.table_name.padEnd(16)} ${row.grantee.padEnd(28)} ${row.privilege_type}`,
    );
  }

  const appWrites = rows.filter(
    (row) =>
      row.grantee === appRole &&
      row.table_name === "AuditEvent" &&
      (row.privilege_type === "UPDATE" || row.privilege_type === "DELETE"),
  );

  const ownedByApp = owners.filter((row) => row.owner === appRole);

  ctx.log("");
  if (appWrites.length === 0 && ownedByApp.length === 0) {
    ctx.log(
      "D-149 part 2 is IN FORCE: the application role holds neither UPDATE " +
        "nor DELETE on AuditEvent, and does not own the table, so it cannot " +
        "grant them back.",
    );
  } else if (appWrites.length === 0) {
    // The grants look right and the control is still not there. This is the
    // one state a grant-only report would call green, and it is the reason the
    // owner is queried at all.
    ctx.log(
      "D-149 part 2 is NOT in force, despite the grants above: the " +
        `application role OWNS ${ownedByApp
          .map((row) => row.table_name)
          .join(" and ")}. An owner holds privileges by ownership, not by ` +
        "grant, and re-grants them to itself in one statement — so the " +
        "revoke stops a bare DELETE and nothing that can also issue GRANT, " +
        "which is the actor this control names.",
    );
    ctx.log(
      "  The fix is ownership, not more revokes: migrations must run as a " +
        "role the application never connects as. See ADR-0002.",
    );
  } else {
    // Two different situations produce the same "not in force", and telling an
    // operator to run a script they have already run is how a real warning
    // gets ignored. The separate roles existing is the signal that the
    // deployment step ran; the application role keeping its writes is then the
    // KNOWN remaining half, not a forgotten one.
    const separateRoleExists = rows.some((row) =>
      row.grantee.startsWith("splashtrack_audit_"),
    );

    ctx.log(
      "D-149 part 2 is NOT in force: the application role still holds " +
        `${appWrites.map((row) => row.privilege_type).join(" and ")} on ` +
        "AuditEvent. Append-only currently rests on the audit repository " +
        "being the only writer and exposing no mutation — a code property, " +
        "not a database one.",
    );
    ctx.log(
      separateRoleExists
        ? "  The separate audit roles DO exist, so the deployment step has " +
            "run. What remains is the application half: revoking the app " +
            "role's writes needs the second and third connections, which " +
            "means two new environment variables and therefore an ADR " +
            "(D-037). That section of infra/audit-database-role.sql is " +
            "commented out until then, deliberately — applying it today " +
            "would break the retention path with no connection to run it on."
        : "  Apply infra/audit-database-role.sql as a privileged role. Its " +
            "header states why this is a deployment step and not a migration.",
    );
  }
  return 0;
}
