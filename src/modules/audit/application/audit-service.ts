/**
 * Audit-trail application service (D-149). The public entry point for RECORDING
 * sensitive actions and for VERIFYING the trail's integrity.
 *
 * Recording is a deliberate side effect of an ALREADY-AUTHORIZED action, like
 * the operational logger — `recordAuditEvent` makes no authorization decision
 * of its own; the calling service owns that. It THROWS on failure so a caller
 * can choose its own posture:
 *   - For a "no access without a record" action — revealing a child's
 *     photograph on a class list (F-04), revealing a medical remark — await it
 *     BEFORE disclosing anything. If the record cannot be written, the
 *     disclosure does not happen.
 *   - For an already-committed, separately-logged action, use
 *     {@link recordAuditEventSafe}: failing the response would misrepresent a
 *     change that has already been applied.
 *
 * Never pass personal-data VALUES — only identifiers and field NAMES.
 *
 * SERVER-ONLY.
 */

import type { DatabaseClient } from "@/lib/database";
import { logger } from "@/lib/logging";

import { verifyCheckpointMac } from "../domain/audit-checkpoint";
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  type AuditEventInput,
} from "../domain/audit-event";
import {
  appendAuditEvent,
  countAuditEventsAtOrBelow,
  pruneAuditEventPrefix,
  readAuditChainPage,
  readAuditCheckpoints,
  type AuditPruneOutcome,
} from "../infrastructure/audit-repository";

const auditLogger = logger.child({ component: "audit" });

/** Bounds so one event can never bloat the trail (defense in depth; the typed
 * input already prevents value-carrying fields). */
const REASON_MAX = 500;
const CHANGED_FIELDS_MAX = 32;

/**
 * Records ONE audit event (append-only, hash-chained). Returns the new row's
 * id, sequence and hash. Throws if the append fails — the caller decides
 * whether that should fail the surrounding action.
 *
 * PASS `client` — the caller's transaction — when the event evidences a write
 * in that same transaction, so the record and the change commit together or
 * neither does. Every write in the `people` module does. See
 * `appendAuditEvent`'s doc comment for what happens without it and what it
 * costs.
 *
 * Lightly bounds `reason` and `changedFields` size. It does NOT and cannot
 * detect a personal-data value placed there by a mis-using caller: the typed
 * input makes the right thing easy, and code review is what makes the wrong
 * thing visible.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
  client?: DatabaseClient,
): Promise<{ id: string; sequence: number; hash: string }> {
  const reason =
    input.reason != null ? input.reason.slice(0, REASON_MAX) : input.reason;
  const changedFields =
    input.changedFields != null
      ? Object.fromEntries(
          Object.entries(input.changedFields).slice(0, CHANGED_FIELDS_MAX),
        )
      : input.changedFields;

  const result = await appendAuditEvent(
    { ...input, reason, changedFields },
    client,
  );
  // A low-volume confirmation on the operational logger (ids only) so an audit
  // append is itself observable in ops tooling — never the changedFields/reason.
  auditLogger.debug(
    { event: "audit.recorded", eventType: input.eventType, auditId: result.id },
    "audit event recorded",
  );
  return result;
}

/**
 * Records an audit event BEST-EFFORT: like {@link recordAuditEvent} but never
 * throws — a failed append is logged to the operational logger instead. For
 * events audited AFTER their change has already committed, where failing the
 * response would misrepresent an applied change. For a "no access without a
 * record" event, use the throwing `recordAuditEvent` and await it before
 * disclosing anything.
 */
export async function recordAuditEventSafe(
  input: AuditEventInput,
): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    auditLogger.error(
      { event: "audit.record_failed", eventType: input.eventType, err: error },
      "failed to record audit event (the audited action had already been applied)",
    );
  }
}

/** The result of verifying the trail (D-149 part 1, D-168 rule 4). */
export interface AuditChainVerification {
  valid: boolean;
  /** Events walked — the SURVIVING trail, not everything ever written. */
  count: number;
  /**
   * How many contiguous pruned segments the checkpoints account for. This is
   * the "intact across N pruned segments" figure D-168 asks the command to
   * report: a stated gap, never an unexplained hole.
   */
  prunedSegments: number;
  /** The `sequence` of the FIRST event that fails verification, when invalid. */
  brokenAtSequence?: number;
  /** The `sequence` of the checkpoint that fails verification, when invalid. */
  brokenCheckpointSequence?: number;
  /** One line naming what failed. Present only when invalid. */
  failure?: string;
}

/**
 * Verifies the trail: the checkpoint chain first, then the surviving events
 * from the latest anchor forward, PAGED BY SEQUENCE. Read-only.
 *
 * THE SHAPE, and why it is one shape (D-168 rules 4 and 5):
 *
 *   1. Walk the checkpoints oldest first. For each: verify its MAC under
 *      `HKDF(SECRET_KEY, info="audit-anchor-v1")`, verify its
 *      `previousCheckpointHash` links to the previous one — the FIRST links to
 *      the genesis constant, because genesis is checkpoint zero — and verify it
 *      accounts for a contiguous range that advances.
 *   2. Take the anchor: the latest checkpoint's `(sequence, chainHash)`, or
 *      `(0, AUDIT_GENESIS_HASH)` when nothing has ever been pruned. Both are
 *      "the `previousHash` the next row must carry", which is why there is no
 *      special case for the un-pruned instance.
 *   3. Assert nothing survives BELOW the anchor. A row there is a gap no
 *      checkpoint can describe — an out-of-band insert, or a prune that took a
 *      sparse subset instead of a prefix.
 *   4. Walk the survivors in pages, recomputing `previousHash` linkage and each
 *      row's own hash. A removed row INSIDE the live segment breaks it against
 *      the anchor, which is the property the whole mechanism exists for.
 *
 * ACCEPTED LIMITATIONS, stated rather than glossed:
 *
 *   - **The event chain itself is unkeyed.** An attacker with database write
 *     access can edit a row and recompute the chain forward from it. What the
 *     checkpoint MAC adds is that they cannot DELETE interior rows and forge a
 *     covering checkpoint — that needs the key.
 *   - **Tail truncation still verifies.** Deleting the newest rows leaves an
 *     intact chain. An external anchor of `(count, latest hash)` is the
 *     hardening, and it is not in v1.
 *   - **Host access defeats the MAC.** An attacker holding `SECRET_KEY` can
 *     forge a checkpoint. Nothing in an application prevents that, and host
 *     access is already the boundary design 13 §7 treats as proof of ownership.
 */
export async function verifyAuditChain(): Promise<AuditChainVerification> {
  const checkpoints = await readAuditCheckpoints();

  let expectedCheckpointLink = AUDIT_GENESIS_HASH;
  let previousCheckpointSequence = 0;

  for (const checkpoint of checkpoints) {
    const fail = (failure: string): AuditChainVerification => ({
      valid: false,
      count: 0,
      prunedSegments: checkpoints.length,
      brokenCheckpointSequence: checkpoint.sequence,
      failure,
    });

    if (!verifyCheckpointMac(checkpoint)) {
      // Either forged, or written under different key material. Both are
      // reported; neither is guessed at, because the two call for opposite
      // responses and the MAC cannot tell them apart.
      return fail(
        `checkpoint at sequence ${checkpoint.sequence} fails its MAC — it was ` +
          "forged, or written under different key material",
      );
    }
    if (checkpoint.previousCheckpointHash !== expectedCheckpointLink) {
      return fail(
        `checkpoint at sequence ${checkpoint.sequence} does not link to the ` +
          "previous checkpoint — one has been removed or reordered",
      );
    }
    if (
      checkpoint.prunedToSequence !== checkpoint.sequence ||
      checkpoint.prunedFromSequence > checkpoint.prunedToSequence ||
      checkpoint.prunedFromSequence <= previousCheckpointSequence ||
      checkpoint.prunedCount <= 0
    ) {
      return fail(
        `checkpoint at sequence ${checkpoint.sequence} does not account for a ` +
          "contiguous range advancing from the previous checkpoint",
      );
    }

    expectedCheckpointLink = checkpoint.mac;
    previousCheckpointSequence = checkpoint.sequence;
  }

  const latest = checkpoints.at(-1);
  const anchorSequence = latest?.sequence ?? 0;
  const anchorHash = latest?.chainHash ?? AUDIT_GENESIS_HASH;

  if (anchorSequence > 0) {
    const belowAnchor = await countAuditEventsAtOrBelow(anchorSequence);
    if (belowAnchor > 0) {
      return {
        valid: false,
        count: 0,
        prunedSegments: checkpoints.length,
        brokenCheckpointSequence: anchorSequence,
        failure:
          `${belowAnchor} event(s) survive at or below the anchor at sequence ` +
          `${anchorSequence}. Retention prunes a contiguous PREFIX; a row left ` +
          "behind means a sparse delete or an out-of-band insert",
      };
    }
  }

  let previousHash = anchorHash;
  let cursor = anchorSequence;
  let count = 0;

  for (;;) {
    const page = await readAuditChainPage(cursor);
    if (page.length === 0) break;

    for (const row of page) {
      // Canonicalize each row by its OWN contentVersion: a v1 row digests to
      // the original field array and a v2 row to that array plus its credential
      // actor, so v1 and v2 rows verify side by side in one chain.
      const expected = computeAuditHash(previousHash, {
        contentVersion: row.contentVersion,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        outcome: row.outcome,
        actorPersonId: row.actorPersonId,
        actorCredentialId: row.actorCredentialId,
        actorAuthMethod: row.actorAuthMethod,
        targetType: row.targetType,
        targetId: row.targetId,
        requestId: row.requestId,
        changedFields: row.changedFields,
        reason: row.reason,
      });
      if (row.previousHash !== previousHash || row.hash !== expected) {
        return {
          valid: false,
          count: count + 1,
          prunedSegments: checkpoints.length,
          brokenAtSequence: row.sequence,
          failure:
            `event at sequence ${row.sequence} does not match the chain — an ` +
            "interior row was edited, deleted, reordered or inserted out of band",
        };
      }
      previousHash = row.hash;
      count += 1;
      cursor = row.sequence;
    }
  }

  return { valid: true, count, prunedSegments: checkpoints.length };
}

/**
 * THE RETENTION RUN (D-168, and D-149 part 3's "third, narrowly-scoped path").
 * Deletes every event that expired before `cutoff`, as a contiguous prefix,
 * behind a signed checkpoint written in the same transaction — then records an
 * audit event for the deletion itself.
 *
 * TWO THINGS THIS DOES NOT DO, both deliberate:
 *
 *   - **It does not choose `cutoff`.** The audit retention floor is COMPUTED —
 *     `max(12 months, the longest retention among the classes the events
 *     evidence)` — and those classes are the retention-policy columns of D-014
 *     and D-065, which do not exist yet. The floor belongs with them, in the
 *     second half of phase 0.4, and putting a hardcoded twelve months here now
 *     would be exactly the "operator keeps two numbers in step" mistake D-168
 *     removes. Until then the caller states the cutoff and owns it.
 *   - **It does not run itself.** There is no scheduler in the foundation. This
 *     is called by the retention job when the maintenance module exists, and by
 *     `npm run audit:verify -- --prune-before=<iso>` for a deliberate operator
 *     action in the meantime.
 *
 * The audit event for the prune is appended AFTER the transaction commits: the
 * append takes the same advisory lock, so writing it inside would deadlock, and
 * appending after keeps it in the surviving segment where it belongs.
 */
export async function pruneAuditTrail(
  cutoff: Date,
  reason: string,
): Promise<AuditPruneOutcome> {
  const outcome = await pruneAuditEventPrefix(cutoff);

  if (outcome.prunedCount > 0) {
    await recordAuditEvent({
      eventType: "audit.retention_pruned",
      outcome: "SUCCESS",
      targetType: "audit_checkpoint",
      targetId: outcome.checkpointId,
      reason,
      changedFields: {
        prunedCount: outcome.prunedCount,
        prunedFromSequence: outcome.prunedFromSequence ?? null,
        prunedToSequence: outcome.prunedToSequence ?? null,
        cutoff: cutoff.toISOString(),
      },
    });
  }

  return outcome;
}
