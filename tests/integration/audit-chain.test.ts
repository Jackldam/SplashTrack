import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import {
  recordAuditEvent,
  recordAuditEventSafe,
  verifyAuditChain,
} from "@/modules/audit";

import { disconnectRoleClients, ownerClient } from "../support/database-roles";

/**
 * The audit chain against a REAL Postgres (D-149).
 *
 * `tests/unit/audit-hash.test.ts` covers the hash primitives in isolation.
 * This covers what only a database can: the advisory-locked append, the
 * `previousHash` linkage across rows, the autoincrement `sequence` the walk
 * depends on, and — the assertion that actually matters — that
 * `verifyAuditChain` NOTICES an interior row being edited.
 *
 * Without that last one, "tamper-evident" is a claim about code nobody ran.
 * The template shipped the chain and a unit test for the digest; whether the
 * chain caught a real UPDATE was never asserted anywhere.
 *
 * This test is also the proof that the database-bound half of the test harness
 * works at all: it is the first thing in this repository to open a connection
 * from a test.
 *
 * It writes to `AuditEvent`, which the production code treats as append-only.
 * That is exactly why it truncates rather than deletes selectively — a partial
 * delete would orphan `previousHash` links and make the NEXT test report
 * tampering that never happened. `scripts/setup-test-db.ts` does the same
 * before the suite starts.
 */

async function truncateAuditTrail(): Promise<void> {
  // AS THE OWNER. Since ADR-0002 no application role holds TRUNCATE on
  // `AuditEvent` — the runtime role is append-only and the retention role may
  // only DELETE behind a checkpoint — so a test reset needs the one identity
  // that owns the table. That this line had to change is the control arriving.
  await owner.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditEvent", "AuditCheckpoint"',
  );
}

afterEach(async () => {
  await truncateAuditTrail();
});

const owner = ownerClient();

afterAll(async () => {
  await disconnectRoleClients();
});

describe("audit chain (real database)", () => {
  it("verifies an empty trail", async () => {
    await truncateAuditTrail();
    // `prunedSegments: 0` — never pruned, so verification anchors on genesis
    // (checkpoint zero). See tests/integration/audit-checkpoint.test.ts.
    await expect(verifyAuditChain()).resolves.toEqual({
      valid: true,
      count: 0,
      prunedSegments: 0,
    });
  });

  it("links appended rows into a chain that verifies", async () => {
    await truncateAuditTrail();

    const first = await recordAuditEvent({
      eventType: "test.first",
      outcome: "SUCCESS",
      actorPersonId: "person_1",
      targetType: "person",
      targetId: "person_2",
      changedFields: { fieldKey: "givenName" },
    });
    const second = await recordAuditEvent({
      eventType: "test.second",
      outcome: "DENIED",
      reason: "out_of_reach",
    });

    expect(second.sequence).toBeGreaterThan(first.sequence);

    const rows = await prisma.auditEvent.findMany({
      orderBy: { sequence: "asc" },
      select: { hash: true, previousHash: true },
    });
    expect(rows).toHaveLength(2);
    // The second row commits to the first row's hash. This is the linkage; the
    // digest itself is unit-tested.
    expect(rows[1].previousHash).toBe(rows[0].hash);

    await expect(verifyAuditChain()).resolves.toEqual({
      valid: true,
      count: 2,
      prunedSegments: 0,
    });
  });

  it("detects an interior row being edited", async () => {
    await truncateAuditTrail();

    await recordAuditEvent({ eventType: "test.a", outcome: "SUCCESS" });
    const tampered = await recordAuditEvent({
      eventType: "test.b",
      outcome: "SUCCESS",
      reason: "original",
    });
    await recordAuditEvent({ eventType: "test.c", outcome: "SUCCESS" });

    // Edit the MIDDLE row's audited content without touching its stored hash —
    // exactly what someone quietly rewriting history would do.
    //
    // THROUGH THE OWNER, because the runtime role can no longer do this at all:
    // D-149 part 2 is in force (ADR-0002), so an injection or a stolen
    // `DATABASE_URL` is refused by PostgreSQL before it reaches this row. The
    // hash chain is the layer BEHIND that one, and what this test asserts is
    // that it still catches an attacker who got past the first — which is the
    // only interesting question once the first layer exists.
    await owner.auditEvent.update({
      where: { id: tampered.id },
      data: { reason: "rewritten" },
    });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(false);
    // `count` is rows WALKED, up to and including the one that failed — not the
    // table's size. The walk is paged now (D-168 rule 4), so a total would
    // require a second query whose only purpose is a nicer-looking number.
    expect(result.count).toBe(2);
    expect(result.brokenAtSequence).toBe(tampered.sequence);
  });

  it("records an event with no actor (a system action)", async () => {
    await truncateAuditTrail();

    // Nothing here is personal data — that is the content rule, and a system
    // action is the case where it is easiest to reach for context that is.
    await recordAuditEventSafe({
      eventType: "test.system",
      outcome: "FAILURE",
      actorPersonId: null,
      actorAuthMethod: null,
      reason: "scheduled_run_failed",
    });

    const row = await prisma.auditEvent.findFirst({
      orderBy: { sequence: "desc" },
      select: { actorPersonId: true, eventType: true, outcome: true },
    });
    expect(row).toEqual({
      actorPersonId: null,
      eventType: "test.system",
      outcome: "FAILURE",
    });
  });
});
