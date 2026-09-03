/**
 * `audit:verify`.
 *
 * `audit:verify` is D-149 part 1 on the image, reporting in D-168's shape —
 * "intact across N pruned segments". `scripts/audit-verify.ts` delegates here so
 * there is one implementation rather than a script and a binary that drift.
 *
 */

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
