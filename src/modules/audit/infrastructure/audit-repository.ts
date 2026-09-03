/**
 * Persistence for the audit trail (D-149). The ONLY writer of `AuditEvent`, and
 * it is APPEND-ONLY: it exposes `appendAuditEvent` and a read, and deliberately
 * NO update and NO delete. Appends are serialized by a Postgres advisory lock
 * so the tamper-evidence hash chain never forks.
 *
 * PHASE 0.4 — two things D-149/D-168 require that are NOT here:
 *   - The INSERT-ONLY DATABASE ROLE. Today "append-only" holds because this
 *     module is the only writer and exposes no mutation. D-149 makes it a
 *     `REVOKE UPDATE, DELETE` on the application's role, so it survives a
 *     future author who reaches for `prisma.auditEvent` directly.
 *   - `AuditCheckpoint`, the checkpointing retention path, and the chunked
 *     segment walk `readAuditChain` below needs.
 *
 * The template's filtered/paginated read surface and its subject-scoped export
 * reads are NOT extracted: both are the audit VIEWER, which is gated on an
 * `audit.read` permission that does not exist yet (D-147, phase 0.4).
 *
 * SERVER-ONLY.
 */

import { Prisma, prisma } from "@/lib/database";

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
 */
export async function appendAuditEvent(
  input: AuditEventInput,
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

  return prisma.$transaction(async (tx) => {
    // Serialize appends so the chain never forks (see the lock-key comment).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})`;

    const tail = await tx.auditEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { hash: true },
    });
    const previousHash = tail?.hash ?? AUDIT_GENESIS_HASH;
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
  });
}

/**
 * Reads every event in chain order (by `sequence`) with the fields needed to
 * recompute the hash chain. Ordered ascending so the walk starts at the genesis
 * link.
 *
 * PHASE 0.4 (D-168): this loads the WHOLE chain into memory, which is fine for
 * an empty database and wrong for a two-year-old instance. The repair specifies
 * a CHUNKED SEGMENT WALK anchored on `AuditCheckpoint` — verify from the last
 * checkpoint forward, in bounded segments — which is also what makes a
 * retention run possible without breaking the chain permanently. Do not paper
 * over this with a `take`: a partial read that reports "valid" is worse than a
 * slow one that reports the truth.
 */
export async function readAuditChain(): Promise<StoredAuditEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { sequence: "asc" },
    select: {
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
    },
  });
  return rows.map((row) => ({
    ...row,
    outcome: row.outcome as AuditOutcome,
    changedFields: row.changedFields ?? null,
  }));
}
