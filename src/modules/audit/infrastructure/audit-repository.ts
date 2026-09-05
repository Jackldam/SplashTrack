/**
 * Persistence for the audit trail (D-149). The ONLY writer of `AuditEvent`, and
 * it is APPEND-ONLY: it exposes `appendAuditEvent` and a read, and deliberately
 * NO update and NO delete. Appends are serialized by a Postgres advisory lock
 * so the tamper-evidence hash chain never forks.
 *
 * APPEND-ONLY WITH EXACTLY ONE EXCEPTION, and the exception is what makes the
 * rule enforceable: `pruneAuditEventPrefix` deletes a contiguous expired PREFIX
 * and writes the covering `AuditCheckpoint` in the same transaction (D-168).
 * There is no other delete path and no update path at all, so a gap that no
 * checkpoint accounts for is unambiguously tampering rather than "probably
 * retention".
 *
 * THE INSERT-ONLY DATABASE ROLE IS A DEPLOYMENT STEP, NOT SOMETHING THIS FILE
 * CAN DO. Today "append-only" holds because this module is the only writer and
 * exposes no mutation — a CODE property. D-149 makes it a `REVOKE UPDATE,
 * DELETE` on the application's role, so it survives a future author who reaches
 * for `prisma.auditEvent` directly. `infra/audit-database-role.sql` is the SQL
 * and its header carries the decision: an operator runs it once, as a
 * privileged role, because the application's own role is not a superuser
 * (D-116) and could not grant it — and if it could, the separation would be
 * decorative. `splashtrack audit:grants` reports at every container start
 * whether it is actually in force, so this is checkable rather than assumed.
 *
 * The template's filtered/paginated read surface and its subject-scoped export
 * reads are NOT extracted: both are the audit VIEWER, which is gated on an
 * `audit.read` permission that does not exist yet (D-147, phase 0.4).
 *
 * SERVER-ONLY.
 */

import { Prisma, prisma, type DatabaseClient } from "@/lib/database";

import {
  computeCheckpointMac,
  CURRENT_CHECKPOINT_MAC_VERSION,
  type AuditCheckpointContent,
  type StoredAuditCheckpoint,
} from "../domain/audit-checkpoint";
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  CURRENT_AUDIT_CONTENT_VERSION,
  type AuditEventInput,
  type AuditHashContent,
  type AuditOutcome,
} from "../domain/audit-event";

/**
 * A fixed key for the transaction-scoped advisory lock that serializes appends.
 * Every append takes `pg_advisory_xact_lock(AUDIT_APPEND_LOCK_KEY)` first, so
 * at most one append computes-then-inserts at a time and the `previousHash` it
 * reads is always the true latest row — the chain cannot fork. The lock is
 * released automatically at transaction end.
 *
 * THE LOCK IS A THROUGHPUT CONSTRAINT, AND `05-technical.md` §5 RULE 7 IS ABOUT
 * IT. The domain model requires one transaction per group registration; at 30
 * students that is 30 attendance events and, naively, 30 chained audit rows
 * taken one at a time against a lock every other audit writer contends for. So:
 * write ONE audit event per aggregate write, not per row — or batch the chain
 * append. This must be decided before the attendance load test is written; the
 * p95 target in `00-overview.md` §4.1 was set without knowing this lock exists.
 *
 * A second bound is attacker-influenced rather than operator-influenced: failed
 * sign-in attempts are on this trail too. `/two-factor/verify-*` failures stay
 * bounded by the two-factor plugin's own in-endpoint account lockout, which
 * applies whatever the entry point. `/passkey/verify-authentication` failures
 * have no account to lock — the ceremony can fail before any user is resolved —
 * so they are rate-limited per hashed source IP in the audit hook itself. What
 * is NOT bounded today is a direct POST to `/api/auth/sign-in/email`: the
 * Better Auth route mounts the full endpoint surface with no throttle in front
 * of it. Known and accepted, not solved by this lock — the fix is a throttle in
 * `middleware.ts`, keyed the same way.
 */
const AUDIT_APPEND_LOCK_KEY = 748_921_163;

/** One row projected for chain verification / read-back. */
export interface StoredAuditEvent extends AuditHashContent {
  id: string;
  sequence: number;
  previousHash: string;
  hash: string;
}

/**
 * Appends one event to the trail and returns its id, sequence and hash. Runs
 * inside a transaction that first serializes on the advisory lock, then links
 * the new row to the current tail via `previousHash` and stores its computed
 * `hash`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `client` — RUNNING THE APPEND INSIDE THE CALLER'S TRANSACTION (phase 1.1)
 *
 * Pass the caller's transaction client to make the audit event and the change
 * it evidences ATOMIC. This is the `DatabaseClient` pattern `@/lib/database`
 * exists for, and the first domain module is what made it necessary.
 *
 * Without it, a module writing personal data inside `prisma.$transaction` and
 * calling this function gets a SECOND, independent transaction on a different
 * pooled connection: it commits on its own, so a rollback of the outer
 * transaction leaves behind an audit event for a change that never happened —
 * an append-only trail asserting something false, which cannot then be
 * corrected. With it, the record and the change commit together or neither
 * does.
 *
 * THE COST, STATED: `pg_advisory_xact_lock` is TRANSACTION-scoped, so the audit
 * append lock is now held until the CALLER's transaction commits rather than
 * until this one does. That lengthens the critical section every other audit
 * writer contends for, which is the same throughput constraint
 * `05-technical.md` §5 rule 7 is about — one event per aggregate write, and
 * short transactions around personal-data writes. It is the right trade: a
 * slower append is a performance problem, and an audit event for a change that
 * did not happen is an integrity one.
 *
 * DO NOT pass a client from a transaction that ALREADY holds this lock
 * (`pruneAuditEventPrefix`). `pruneAuditTrail` appends after its transaction
 * commits for exactly that reason, and that remains correct.
 */
export async function appendAuditEvent(
  input: AuditEventInput,
  client?: DatabaseClient,
): Promise<{ id: string; sequence: number; hash: string }> {
  const occurredAt = new Date();
  const content: AuditHashContent = {
    // New rows are written at the current canonicalization version; the column
    // is stored so verification later re-canonicalizes each row by its own.
    contentVersion: CURRENT_AUDIT_CONTENT_VERSION,
    eventType: input.eventType,
    occurredAt,
    outcome: input.outcome,
    actorPersonId: input.actorPersonId ?? null,
    actorCredentialId: input.actorCredentialId ?? null,
    actorAuthMethod: input.actorAuthMethod ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    requestId: input.requestId ?? null,
    changedFields: input.changedFields ?? null,
    reason: input.reason ?? null,
  };

  /**
   * The append itself. Factored out so it can run EITHER in a transaction of
   * its own (the default) OR inside a caller's, which is the whole point of the
   * optional `client` parameter — see the doc comment above.
   */
  const append = async (tx: DatabaseClient) => {
    // Serialize appends so the chain never forks (see the lock-key comment).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})`;

    const tail = await tx.auditEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { hash: true },
    });

    // WHAT AN EMPTY TABLE MEANS DEPENDS ON WHETHER IT WAS EVER PRUNED.
    //
    // An instance quieter than its own retention window ends a retention run
    // with NO events left — every one of them expired. Chaining the next append
    // from the genesis constant there would silently fork the chain: the latest
    // checkpoint's `chainHash` is the anchor verification resumes from, and a
    // first surviving row carrying genesis instead would fail against it
    // forever. So the fallback is the anchor, and genesis only when there is no
    // checkpoint either — which is exactly "genesis is checkpoint zero"
    // (D-168 rule 5) expressed at the write side.
    const anchor = tail
      ? null
      : await tx.auditCheckpoint.findFirst({
          orderBy: { sequence: "desc" },
          select: { chainHash: true },
        });

    const previousHash = tail?.hash ?? anchor?.chainHash ?? AUDIT_GENESIS_HASH;
    const hash = computeAuditHash(previousHash, content);

    const row = await tx.auditEvent.create({
      data: {
        contentVersion: content.contentVersion,
        eventType: content.eventType,
        occurredAt,
        outcome: content.outcome as AuditOutcome,
        actorPersonId: content.actorPersonId,
        actorCredentialId: content.actorCredentialId,
        actorAuthMethod: content.actorAuthMethod,
        targetType: content.targetType,
        targetId: content.targetId,
        requestId: content.requestId,
        changedFields:
          input.changedFields == null
            ? Prisma.JsonNull
            : (input.changedFields as Prisma.InputJsonValue),
        reason: content.reason,
        previousHash,
        hash,
      },
      select: { id: true, sequence: true, hash: true },
    });
    return row;
  };

  return client ? append(client) : prisma.$transaction(append);
}

/** Default page size for the segment walk. Bounded memory, one round trip. */
export const AUDIT_CHAIN_PAGE_SIZE = 1_000;

const CHAIN_SELECT = {
  id: true,
  sequence: true,
  contentVersion: true,
  eventType: true,
  occurredAt: true,
  outcome: true,
  actorPersonId: true,
  actorCredentialId: true,
  actorAuthMethod: true,
  targetType: true,
  targetId: true,
  requestId: true,
  changedFields: true,
  reason: true,
  previousHash: true,
  hash: true,
} as const;

/**
 * Reads ONE PAGE of the chain in `sequence` order, strictly after
 * `afterSequence`, with the fields needed to recompute the hash chain.
 *
 * PAGED, NOT MATERIALISED (D-168 rule 4). The inherited `readAuditChain()` read
 * every row into memory; `07-operations.md` §2 calls `AuditEvent` the
 * fastest-growing table in the product, so on a two-year instance that made
 * verification unrunnable — a control nobody can afford to run is not a
 * control. This is the replacement, and the caller walks pages until one comes
 * back short.
 *
 * NOTE the shape this deliberately does NOT have: a `take` on a single call
 * that lets a caller verify "the first N rows" and report valid. A partial read
 * reporting success is worse than a slow one reporting the truth.
 */
export async function readAuditChainPage(
  afterSequence: number,
  limit: number = AUDIT_CHAIN_PAGE_SIZE,
): Promise<StoredAuditEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { sequence: { gt: afterSequence } },
    orderBy: { sequence: "asc" },
    take: limit,
    select: CHAIN_SELECT,
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}

/**
 * How many events survive at or below `sequence`. Used by verification to catch
 * the case no anchor can explain: a row still present BELOW the latest
 * checkpoint's anchor means either an out-of-band insert or a prune that
 * deleted a sparse subset instead of a prefix. Both are tampering signals.
 */
export async function countAuditEventsAtOrBelow(
  sequence: number,
): Promise<number> {
  return prisma.auditEvent.count({ where: { sequence: { lte: sequence } } });
}

/** Every checkpoint, oldest first. Small: one row per retention run. */
export async function readAuditCheckpoints(): Promise<StoredAuditCheckpoint[]> {
  return prisma.auditCheckpoint.findMany({ orderBy: { sequence: "asc" } });
}

/** The newest checkpoint, or null when the trail has never been pruned. */
export async function readLatestAuditCheckpoint(): Promise<StoredAuditCheckpoint | null> {
  return prisma.auditCheckpoint.findFirst({ orderBy: { sequence: "desc" } });
}

/** What one retention run did. `prunedCount: 0` means it found nothing. */
export interface AuditPruneOutcome {
  prunedCount: number;
  prunedFromSequence?: number;
  prunedToSequence?: number;
  checkpointId?: string;
}

/**
 * THE ONLY DELETE PATH FOR `AuditEvent` (D-168 rule 1). Writes the checkpoint
 * and deletes the rows it accounts for IN ONE TRANSACTION, so a gap without a
 * covering checkpoint can only be tampering.
 *
 * PREFIX ONLY (rule 2). An event is deletable only if EVERY event at or below
 * its sequence is deletable, so the deletable set is `sequence <
 * firstSurvivingSequence` where the first survivor is the lowest-sequenced row
 * that has not expired. That is not the same as `occurredAt < cutoff`: appends
 * take their timestamp in the application before the row is inserted, so under
 * concurrency a lower sequence can carry a later `occurredAt`, and a naive
 * `DELETE … WHERE occurredAt < ?` would punch a sparse hole that no anchor can
 * describe.
 *
 * Serialized on the SAME advisory lock as appends, so a prune and an append can
 * never interleave and read each other's half-written view of the tail.
 *
 * Returns `{ prunedCount: 0 }` and writes NOTHING when there is nothing to
 * prune — a no-op checkpoint would break the strict monotonicity of `sequence`
 * and add a row that accounts for no gap.
 *
 * IT TAKES A CLIENT, AND THE DEFAULT IS THE WRONG ONE ON PURPOSE. Since
 * ADR-0002 the runtime role holds no `DELETE` on `AuditEvent`, so calling this
 * with the default client fails with `permission denied for table AuditEvent`
 * — which is the control working, not a bug. `pruneAuditTrail` supplies
 * `maintenanceClient()`. The default is kept so the signature does not force
 * every caller to think about connections, and so that a future caller which
 * forgets is refused by the DATABASE rather than by a code review.
 */
export async function pruneAuditEventPrefix(
  cutoff: Date,
  client: typeof prisma = prisma,
): Promise<AuditPruneOutcome> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})`;

    const anchor = await tx.auditCheckpoint.findFirst({
      orderBy: { sequence: "desc" },
    });
    const floor = anchor?.sequence ?? 0;

    // The lowest-sequenced row that must SURVIVE. Everything below it is a
    // contiguous expired prefix; everything from it up stays, even if some
    // later row happens to carry an older timestamp.
    const firstSurvivor = await tx.auditEvent.findFirst({
      where: { sequence: { gt: floor }, occurredAt: { gte: cutoff } },
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });

    const upperBound = firstSurvivor
      ? firstSurvivor.sequence - 1
      : // NOTHING survives the cutoff — an instance quieter than its own
        // retention window. The prefix then runs to the current tail and the
        // table is left EMPTY, which is correct and not a special case: the
        // checkpoint still holds the last row's hash as the anchor, and
        // `appendAuditEvent` chains the next event from that anchor rather than
        // from genesis. Retaining one row instead would keep an event past its
        // retention purely to hold a hash, which is the wrong trade in a system
        // whose audit rows are personal data.
        ((
          await tx.auditEvent.findFirst({
            where: { sequence: { gt: floor } },
            orderBy: { sequence: "desc" },
            select: { sequence: true },
          })
        )?.sequence ?? floor);

    if (upperBound <= floor) return { prunedCount: 0 };

    const range = { sequence: { gt: floor, lte: upperBound } };
    const [aggregate, anchorRow] = await Promise.all([
      tx.auditEvent.aggregate({
        where: range,
        _count: { _all: true },
        _min: { occurredAt: true, sequence: true },
        _max: { occurredAt: true },
      }),
      // `findFirst`, not `findUnique`: `AuditEvent.sequence` is monotonic but
      // carries no unique constraint, so it is not a unique-input field.
      tx.auditEvent.findFirst({
        where: { sequence: upperBound },
        select: { hash: true },
      }),
    ]);

    if (
      aggregate._count._all === 0 ||
      !anchorRow ||
      aggregate._min.sequence == null ||
      aggregate._min.occurredAt == null ||
      aggregate._max.occurredAt == null
    ) {
      return { prunedCount: 0 };
    }

    const content: AuditCheckpointContent = {
      macVersion: CURRENT_CHECKPOINT_MAC_VERSION,
      // The anchor: the LAST PRUNED row and its hash, which is exactly the
      // `previousHash` the first surviving row carries. See
      // `../domain/audit-checkpoint.ts`.
      sequence: upperBound,
      chainHash: anchorRow.hash,
      prunedFromSequence: aggregate._min.sequence,
      prunedToSequence: upperBound,
      prunedCount: aggregate._count._all,
      prunedFrom: aggregate._min.occurredAt,
      prunedTo: aggregate._max.occurredAt,
      previousCheckpointHash: anchor?.mac ?? AUDIT_GENESIS_HASH,
      createdAt: new Date(),
    };

    const checkpoint = await tx.auditCheckpoint.create({
      data: { ...content, mac: computeCheckpointMac(content) },
      select: { id: true },
    });
    await tx.auditEvent.deleteMany({ where: range });

    return {
      prunedCount: content.prunedCount,
      prunedFromSequence: content.prunedFromSequence,
      prunedToSequence: content.prunedToSequence,
      checkpointId: checkpoint.id,
    };
  });
}
