import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  pruneAuditTrail,
  recordAuditEvent,
  verifyAuditChain,
} from "@/modules/audit";
import { AUDIT_GENESIS_HASH } from "@/modules/audit/domain/audit-event";
import { disconnectRoleClients, ownerClient } from "../support/database-roles";

/**
 * Checkpointing across a retention boundary, against a REAL Postgres (D-168).
 *
 * THE CONTRADICTION THIS PROVES RESOLVED. D-149 part 1 requires `audit:verify`;
 * D-149 part 3 makes retention configurable, and `01-domain-model.md` §5 gives
 * the audit row `onExpiry: DELETE`. Verification walked from genesis, so the
 * FIRST legitimate retention run — month 12 to 24 of the first instance —
 * deleted the anchor and left the chain permanently unverifiable: a tamper
 * detector with a 100% false-positive rate from month twelve, which is worse
 * than none (F-137).
 *
 * The central test below therefore does not assert that a checkpoint row was
 * written. It DELETES AGED ROWS and then asserts the chain still verifies —
 * because that, and only that, is the property the decision exists for.
 */

async function truncateAuditTrail(): Promise<void> {
  // Both tables together: a checkpoint anchoring a sequence in a trail that no
  // longer exists would make the NEXT test report tampering that never
  // happened.
  //
  // AS THE OWNER (ADR-0002). No application role holds TRUNCATE on these
  // tables: the runtime role is append-only, and the retention role may only
  // DELETE behind a checkpoint, which is the whole of D-168 rule 1.
  await owner.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditEvent", "AuditCheckpoint"',
  );
}

/** Appends `count` events and returns them oldest-first. */
async function appendEvents(count: number) {
  const written = [];
  for (let index = 0; index < count; index += 1) {
    written.push(
      await recordAuditEvent({
        eventType: `test.event_${index}`,
        outcome: "SUCCESS",
        targetType: "person",
        targetId: `person_${index}`,
      }),
    );
  }
  return written;
}

/**
 * Backdates events to a fixed old timestamp so a cutoff can select them.
 * Rewrites `occurredAt` ONLY — which the hash commits to, so these rows no
 * longer verify. Every test that uses it prunes them away before verifying, and
 * that is deliberate: it keeps "aged" and "still in the chain" independent.
 */
async function backdate(sequences: number[], to: Date): Promise<void> {
  // The owner again: rewriting `occurredAt` is an UPDATE on `AuditEvent`, which
  // no application role may perform. Ageing rows is test scaffolding, not
  // something the product does.
  await owner.auditEvent.updateMany({
    where: { sequence: { in: sequences } },
    data: { occurredAt: to },
  });
}

const owner = ownerClient();

const LONG_AGO = new Date("2024-01-01T00:00:00.000Z");
const CUTOFF = new Date("2025-01-01T00:00:00.000Z");

afterEach(async () => {
  await truncateAuditTrail();
});

afterAll(async () => {
  await disconnectRoleClients();
});

describe("audit checkpointing across a retention boundary (D-168)", () => {
  it("still verifies after a retention run actually deletes aged rows", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(6);
    const aged = events.slice(0, 3).map((event) => event.sequence);
    await backdate(aged, LONG_AGO);

    const outcome = await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    // The rows are GONE. This is a real delete, not a soft flag.
    expect(outcome.prunedCount).toBe(3);
    expect(
      await prisma.auditEvent.count({ where: { sequence: { in: aged } } }),
    ).toBe(0);

    // ...and the chain still verifies, across the gap it just made.
    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.prunedSegments).toBe(1);
    // Three survivors plus the `audit.retention_pruned` event the run records.
    expect(result.count).toBe(4);
  });

  it("writes a checkpoint anchored on the last pruned row", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(5);
    const aged = events.slice(0, 2);
    await backdate(
      aged.map((event) => event.sequence),
      LONG_AGO,
    );

    await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    const checkpoint = await prisma.auditCheckpoint.findFirstOrThrow();
    const lastPruned = aged[aged.length - 1];

    // The anchor is the LAST PRUNED row and ITS hash — exactly the value the
    // first surviving row carries in `previousHash`, which is what gives
    // genesis and a checkpoint one shape (D-168 rule 5).
    expect(checkpoint.sequence).toBe(lastPruned.sequence);
    expect(checkpoint.chainHash).toBe(lastPruned.hash);
    expect(checkpoint.prunedToSequence).toBe(lastPruned.sequence);
    expect(checkpoint.prunedFromSequence).toBe(events[0].sequence);
    expect(checkpoint.prunedCount).toBe(2);
    // Genesis is checkpoint zero, so the first checkpoint links to it.
    expect(checkpoint.previousCheckpointHash).toBe(AUDIT_GENESIS_HASH);

    const firstSurvivor = await prisma.auditEvent.findFirstOrThrow({
      orderBy: { sequence: "asc" },
      select: { previousHash: true },
    });
    expect(firstSurvivor.previousHash).toBe(checkpoint.chainHash);
  });

  it("records an audit event for the deletion itself (D-149 part 3)", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(3);
    await backdate([events[0].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    const recorded = await prisma.auditEvent.findFirstOrThrow({
      where: { eventType: "audit.retention_pruned" },
    });
    expect(recorded.outcome).toBe("SUCCESS");
    expect(recorded.reason).toBe("scheduled_retention_run");
    // The evidence that a gap was made is itself on the trail — a retention run
    // that erased its own record would defeat the point.
    expect(recorded.changedFields).toMatchObject({ prunedCount: 1 });
  });

  it("chains successive retention runs and reports N pruned segments", async () => {
    await truncateAuditTrail();

    const first = await appendEvents(4);
    await backdate(
      first.slice(0, 2).map((event) => event.sequence),
      LONG_AGO,
    );
    await pruneAuditTrail(CUTOFF, "run_one");

    const survivors = await prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });
    await backdate(
      survivors.slice(0, 2).map((row) => row.sequence),
      LONG_AGO,
    );
    await pruneAuditTrail(CUTOFF, "run_two");

    const checkpoints = await prisma.auditCheckpoint.findMany({
      orderBy: { sequence: "asc" },
    });
    expect(checkpoints).toHaveLength(2);
    // Checkpoints are themselves chained, so removing one from the middle is
    // detectable rather than just a shorter list.
    expect(checkpoints[1].previousCheckpointHash).toBe(checkpoints[0].mac);
    expect(checkpoints[1].sequence).toBeGreaterThan(checkpoints[0].sequence);

    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.prunedSegments).toBe(2);
  });

  it("prunes nothing, and writes no checkpoint, when nothing has expired", async () => {
    await truncateAuditTrail();
    await appendEvents(3);

    const outcome = await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    expect(outcome.prunedCount).toBe(0);
    // A no-op checkpoint would account for no gap and would break the strict
    // monotonicity the prefix rule rests on.
    expect(await prisma.auditCheckpoint.count()).toBe(0);
    expect((await verifyAuditChain()).valid).toBe(true);
  });

  it("empties the trail when everything has expired, and the next append chains from the anchor", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(3);
    await backdate(
      events.map((event) => event.sequence),
      LONG_AGO,
    );

    const outcome = await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    // An instance quieter than its own retention window: every row goes. No
    // event is kept past its retention just to hold a hash — the checkpoint
    // holds it instead.
    expect(outcome.prunedCount).toBe(3);

    // The ONLY row left is the retention run's own audit event, and it chains
    // from the checkpoint anchor rather than from genesis. Chaining from
    // genesis here would fork the chain silently and permanently.
    const remaining = await prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].eventType).toBe("audit.retention_pruned");
    const checkpoint = await prisma.auditCheckpoint.findFirstOrThrow();
    expect(remaining[0].previousHash).toBe(checkpoint.chainHash);
    expect(remaining[0].previousHash).not.toBe(AUDIT_GENESIS_HASH);

    expect((await verifyAuditChain()).valid).toBe(true);
  });
});

describe("what verification still catches after a prune", () => {
  it("detects an edited row INSIDE the live segment", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(5);
    await backdate([events[0].sequence, events[1].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    const target = events[3];
    // Through the OWNER: since ADR-0002 the runtime role cannot UPDATE an audit
    // row at all. What this test asserts is the layer BEHIND that one — the
    // chain still catches an attacker who got past the grants.
    await owner.auditEvent.update({
      where: { id: target.id },
      data: { reason: "rewritten" },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(target.sequence);
  });

  it("detects rows deleted WITHOUT a checkpoint — the tampering signal", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(4);
    // A compromised administrator deleting the rows that record what they did —
    // FM-7's actor, who holds host access and is therefore explicitly outside
    // what the role model reaches (D-168, ADR-0002 §8). The owner client is how
    // that actor is modelled honestly. There is no legitimate producer of a gap
    // except the checkpointing path, so this must not be mistaken for retention.
    await owner.auditEvent.deleteMany({
      where: { sequence: { in: [events[1].sequence] } },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtSequence).toBe(events[2].sequence);
  });

  it("detects a forged checkpoint", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(4);
    await backdate([events[0].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    // An attacker with DATABASE WRITE ACCESS ONLY widening the checkpoint to
    // cover rows they deleted by hand. Without the key they cannot re-MAC it.
    const checkpoint = await prisma.auditCheckpoint.findFirstOrThrow();
    await owner.auditCheckpoint.update({
      where: { id: checkpoint.id },
      data: { prunedCount: checkpoint.prunedCount + 5 },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.brokenCheckpointSequence).toBe(checkpoint.sequence);
    expect(result.failure).toMatch(/MAC/);
  });

  it("detects a checkpoint removed from the middle of the checkpoint chain", async () => {
    await truncateAuditTrail();

    const first = await appendEvents(4);
    await backdate([first[0].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "run_one");

    const survivors = await prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
      select: { sequence: true },
    });
    await backdate([survivors[0].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "run_two");

    const checkpoints = await prisma.auditCheckpoint.findMany({
      orderBy: { sequence: "asc" },
    });
    await owner.auditCheckpoint.delete({ where: { id: checkpoints[0].id } });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.failure).toMatch(/link/);
  });

  it("detects a row surviving below the anchor", async () => {
    await truncateAuditTrail();

    const events = await appendEvents(4);
    await backdate([events[0].sequence, events[1].sequence], LONG_AGO);
    await pruneAuditTrail(CUTOFF, "scheduled_retention_run");

    // Re-inserting a row below the anchor: a gap no checkpoint can describe,
    // which is exactly what a sparse (per-class) expiry would produce and why
    // D-168 makes the retention floor one instance-wide value.
    const survivor = await prisma.auditEvent.findFirstOrThrow({
      orderBy: { sequence: "asc" },
    });
    await prisma.auditEvent.create({
      data: {
        ...survivor,
        id: "reinserted_below_anchor",
        sequence: events[0].sequence,
        hash: `${survivor.hash}-reinserted`,
        changedFields: survivor.changedFields ?? undefined,
      },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    expect(result.failure).toMatch(/at or below the anchor/);
  });
});

describe("verification is paged, not materialised (D-168 rule 4)", () => {
  it("walks a chain longer than one page", async () => {
    await truncateAuditTrail();

    // `07-operations.md` §2 calls AuditEvent the fastest-growing table in the
    // product, and the inherited read loaded every row into memory. This is a
    // small proof that the paged walk crosses its own page boundary correctly —
    // an off-by-one at the cursor would silently skip or re-verify a row.
    const { readAuditChainPage } =
      await import("@/modules/audit/infrastructure/audit-repository");
    const events = await appendEvents(7);

    const firstPage = await readAuditChainPage(0, 3);
    expect(firstPage).toHaveLength(3);
    const secondPage = await readAuditChainPage(firstPage[2].sequence, 3);
    expect(secondPage[0].sequence).toBe(events[3].sequence);
    const lastPage = await readAuditChainPage(secondPage[2].sequence, 3);
    expect(lastPage).toHaveLength(1);
    expect(await readAuditChainPage(lastPage[0].sequence, 3)).toHaveLength(0);

    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.count).toBe(7);
  });
});
