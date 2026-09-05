/**
 * `audit:verify` — the chain-verification command D-149 part 1 requires.
 *
 *     npm run audit:verify
 *     npm run audit:verify -- --prune-before=2025-01-01 --reason=scheduled_retention
 *
 * D-149's first part is not "the chain is verifiable"; it is *"the verification
 * is somewhere a human sees it"*. A tamper-evident record nobody ever checks is
 * tamper-evident in the same way an unwatched camera is. The design names
 * `splashtrack audit:verify` plus a chain-status line on the diagnostics page.
 * The diagnostics page needs the permission guard, which is the second half of
 * phase 0.4; there is also no `splashtrack` binary yet, since the CLI surface
 * arrives with the container image. This script is that command in the
 * meantime, and it reports in the shape D-168 specifies:
 *
 *     intact across N pruned segments
 *
 * EXIT CODES, so a cron entry or a monitor can use it: 0 intact, 1 broken,
 * 2 could not run.
 *
 * `--prune-before` runs a RETENTION PASS first. It is deliberately not the
 * default and deliberately explicit: this is the only path that deletes audit
 * rows, and until the retention-policy columns exist (D-014/D-065, the second
 * half of phase 0.4) the audit floor cannot be COMPUTED, so an operator states
 * the cutoff and owns it. See `pruneAuditTrail`.
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";

async function main(): Promise<number> {
  loadEnv({ path: path.resolve(process.cwd(), ".env") });

  const args = process.argv.slice(2);
  const pruneBefore = valueOf(args, "--prune-before");
  const reason = valueOf(args, "--reason") ?? "manual_retention_run";

  // Imported after dotenv, so the database client and the bootstrap secret both
  // read a populated environment.
  const { pruneAuditTrail, verifyAuditChain } = await import("@/modules/audit");

  if (pruneBefore) {
    const cutoff = new Date(pruneBefore);
    if (Number.isNaN(cutoff.getTime())) {
      console.error(`--prune-before is not a date: "${pruneBefore}"`);
      return 2;
    }
    const outcome = await pruneAuditTrail(cutoff, reason);
    if (outcome.prunedCount === 0) {
      console.log(
        `Retention: nothing had expired before ${cutoff.toISOString()}.`,
      );
    } else {
      console.log(
        `Retention: pruned ${outcome.prunedCount} event(s), sequences ` +
          `${outcome.prunedFromSequence}–${outcome.prunedToSequence}, behind ` +
          `checkpoint ${outcome.checkpointId}.`,
      );
    }
  }

  const result = await verifyAuditChain();

  if (result.valid) {
    console.log(
      `Audit chain intact across ${result.prunedSegments} pruned segment(s); ` +
        `${result.count} event(s) verified.`,
    );
    return 0;
  }

  // Loud, specific, and it never says "probably retention" — the checkpointing
  // path is the ONLY legitimate producer of a gap, so anything else is a
  // finding, and the three Article 33 questions (D-128) are answered from this
  // trail.
  console.error("AUDIT CHAIN BROKEN.");
  console.error(`  ${result.failure ?? "no detail"}`);
  if (result.brokenAtSequence !== undefined) {
    console.error(`  First bad event sequence: ${result.brokenAtSequence}`);
  }
  if (result.brokenCheckpointSequence !== undefined) {
    console.error(
      `  Checkpoint at sequence: ${result.brokenCheckpointSequence}`,
    );
  }
  console.error(`  Pruned segments recorded: ${result.prunedSegments}`);
  return 1;
}

function valueOf(args: string[], flag: string): string | undefined {
  const match = args.find((arg) => arg.startsWith(`${flag}=`));
  return match?.slice(flag.length + 1);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("audit:verify could not run:");
    console.error(error);
    process.exit(2);
  });
