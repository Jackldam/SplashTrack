import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditGrants } from "@/cli/commands/audit";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { claimSchemaForOwner } from "@/lib/database/apply-role-model";
import {
  migrationUrlFrom,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
  roleNameFrom,
} from "@/lib/database/role-model";
import {
  pruneAuditTrail,
  recordAuditEvent,
  verifyAuditChain,
} from "@/modules/audit";
import { pruneAuditEventPrefix } from "@/modules/audit/infrastructure/audit-repository";

import {
  disconnectRoleClients,
  ownerClient,
  retentionClient,
} from "../support/database-roles";

/**
 * ADR-0002 / D-182, asserted against a real PostgreSQL rather than described.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 *
 * D-149 part 2 says the audit trail is append-only to the application. Until
 * this change that was a property of the CODE — the audit repository is the
 * only writer and exposes no mutation — and code properties last exactly as
 * long as the next author who has not read the doc comment. The claim ADR-0002
 * makes is stronger and different in kind: **the database refuses**.
 *
 * A claim like that has to be tested by trying it, because the two ways it goes
 * wrong are both silent. A `REVOKE` against an OWNER succeeds, reports success
 * and changes nothing. A grant against a SUPERUSER is not weak but inert. Both
 * produce a green report over an absent control, which is worse than a red
 * report over the same absence — the reassuring direction is the dangerous one.
 *
 * So every assertion below is an ATTEMPT that must be refused, plus its
 * counterpart that must be permitted. A test that only asserted the refusals
 * would pass just as happily against a database with no `AuditEvent` table at
 * all.
 */

const CUTOFF = new Date("2025-01-01T00:00:00.000Z");
const LONG_AGO = new Date("2024-01-01T00:00:00.000Z");

const owner = ownerClient();
const retention = retentionClient();

/** Empties both audit tables. Only the owner may (see `database-roles`). */
async function reset(): Promise<void> {
  await owner.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditEvent", "AuditCheckpoint"',
  );
}

afterAll(async () => {
  await reset();
  await disconnectRoleClients();
});

describe("the runtime role cannot rewrite the audit trail (D-149 part 2)", () => {
  beforeAll(reset);

  it("is refused an UPDATE by the database, not by the application", async () => {
    const event = await recordAuditEvent({
      eventType: "test.role_model",
      outcome: "SUCCESS",
    });

    // THE COUNTERPART FIRST, so the refusals below cannot pass vacuously: the
    // runtime role really does reach this row, and really can append.
    const readBack = await prisma.auditEvent.findFirst({
      where: { id: event.id },
      select: { id: true },
    });
    expect(readBack?.id).toBe(event.id);

    await expect(
      prisma.auditEvent.update({
        where: { id: event.id },
        data: { reason: "rewritten" },
      }),
    ).rejects.toThrow(/permission denied for table AuditEvent/i);

    // The row is untouched — the refusal is not a rollback of a partial write.
    const after = await prisma.auditEvent.findFirstOrThrow({
      where: { id: event.id },
      select: { reason: true },
    });
    expect(after.reason).toBeNull();
  });

  it("is refused a DELETE, a TRUNCATE and a raw UPDATE alike", async () => {
    await recordAuditEvent({
      eventType: "test.role_model",
      outcome: "SUCCESS",
    });

    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(
      /permission denied for table AuditEvent/i,
    );

    // TRUNCATE is why the provisioning REVOKEs with `ALL` rather than naming
    // UPDATE and DELETE: it empties the table without issuing a single DELETE,
    // so a revoke that named only those two would read as complete and leave
    // this door open.
    await expect(
      prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"'),
    ).rejects.toThrow(/permission denied for table AuditEvent/i);

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditEvent" SET reason = 'x'`),
    ).rejects.toThrow(/permission denied for table AuditEvent/i);

    const survivors = await prisma.auditEvent.count();
    expect(survivors).toBeGreaterThan(0);
  });

  it("cannot grant itself the privilege back, and cannot take the table", async () => {
    const [{ role }] = await prisma.$queryRaw<{ role: string }[]>`
      SELECT current_user AS role
    `;

    // A non-owner's GRANT is a WARNING and a no-op rather than an error, which
    // is why the assertion is on the DELETE that follows rather than on this.
    await prisma
      .$executeRawUnsafe(`GRANT DELETE ON "AuditEvent" TO "${role}"`)
      .catch(() => undefined);

    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(
      /permission denied for table AuditEvent/i,
    );

    await expect(
      prisma.$executeRawUnsafe(`ALTER TABLE "AuditEvent" OWNER TO "${role}"`),
    ).rejects.toThrow(/must be owner of (table|relation)/i);
  });

  it("holds SELECT only on AuditCheckpoint, so it cannot forge a gap's alibi", async () => {
    // A checkpoint is what makes a gap in the trail a STATED fact rather than
    // an unexplained hole (D-168 rule 3). A runtime role that could write one
    // could delete rows and then explain them away.
    await expect(prisma.auditCheckpoint.deleteMany({})).rejects.toThrow(
      /permission denied for table AuditCheckpoint/i,
    );

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AuditCheckpoint" ("id", "sequence", "chainHash", ` +
          `"prunedFromSequence", "prunedToSequence", "prunedCount", ` +
          `"prunedFrom", "prunedTo", "previousCheckpointHash", "mac", ` +
          `"createdAt") VALUES ('forged', 1, 'x', 1, 1, 1, now(), now(), ` +
          `'x', 'x', now())`,
      ),
    ).rejects.toThrow(/permission denied for table AuditCheckpoint/i);

    // And it CAN read them, which is what `audit:verify` needs.
    await expect(
      prisma.auditCheckpoint.count(),
    ).resolves.toBeGreaterThanOrEqual(0);
  });
});

describe("the runtime role is neither a superuser nor an owner (D-116)", () => {
  it("carries none of the four attributes that would make the grants decoration", async () => {
    const [attributes] = await prisma.$queryRaw<
      {
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
      }[]
    >`
      SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
        FROM pg_roles WHERE rolname = current_user
    `;

    // rolsuper is the one that matters most: a superuser bypasses privilege
    // checks outright, so every assertion in this file would pass vacuously
    // against one — the revoke would not be weak, it would be inert. This is
    // the state the reference compose used to produce.
    expect(attributes.rolsuper).toBe(false);
    expect(attributes.rolbypassrls).toBe(false);
    expect(attributes.rolcreaterole).toBe(false);
    // CREATEDB lives on the retention role instead (ADR-0002 §6), so a
    // checkout's runtime role is shaped exactly like a production one.
    expect(attributes.rolcreatedb).toBe(false);
  });

  it("owns neither audit table, and owns nothing at all", async () => {
    const [{ role }] = await prisma.$queryRaw<{ role: string }[]>`
      SELECT current_user AS role
    `;

    const owners = await prisma.$queryRaw<
      { tablename: string; tableowner: string }[]
    >`
      SELECT tablename, tableowner FROM pg_tables
       WHERE schemaname = current_schema()
         AND tablename IN ('AuditEvent', 'AuditCheckpoint')
       ORDER BY tablename
    `;

    // Non-vacuous: the tables exist and are owned by SOMEBODY, and that
    // somebody is the non-connecting owner.
    expect(owners).toHaveLength(2);
    for (const table of owners) {
      expect(table.tableowner).not.toBe(role);
      expect(table.tableowner).toBe(REFERENCE_OWNER_ROLE);
    }

    const owned = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_tables
       WHERE schemaname = current_schema() AND tableowner = ${role}
    `;
    expect(Number(owned[0].count)).toBe(0);
  });

  it("is a different role from the one in DATABASE_MAINTENANCE_URL", async () => {
    // Two credentials, not one wearing two hats. If these ever collapse into
    // the same role, every separation above is notional.
    expect(roleNameFrom(process.env.DATABASE_URL as string)).toBe(
      REFERENCE_APP_ROLE,
    );
    expect(roleNameFrom(process.env.DATABASE_MAINTENANCE_URL as string)).toBe(
      REFERENCE_RETENTION_ROLE,
    );
  });
});

describe("retention deletes, and only retention (D-168)", () => {
  beforeAll(reset);

  it("prunes an expired prefix behind a checkpoint, and the chain still verifies", async () => {
    const written = [];
    for (let index = 0; index < 4; index += 1) {
      written.push(
        await recordAuditEvent({
          eventType: `test.retention_${index}`,
          outcome: "SUCCESS",
        }),
      );
    }

    // Age the first two so a cutoff selects them. Rewriting `occurredAt` is an
    // UPDATE, so it is the owner's to do — a fact this file has already proved
    // the runtime role cannot.
    await owner.auditEvent.updateMany({
      where: { sequence: { in: [written[0].sequence, written[1].sequence] } },
      data: { occurredAt: LONG_AGO },
    });

    // The real path: `pruneAuditTrail` resolves the maintenance client itself.
    const outcome = await pruneAuditTrail(CUTOFF, "role_model_proof");
    expect(outcome.prunedCount).toBe(2);
    expect(outcome.checkpointId).toBeDefined();

    // The rows are gone, the gap is accounted for, and verification still
    // passes ACROSS it — which is the whole of D-168 and the reason retention
    // is allowed to delete at all.
    const remaining = await prisma.auditEvent.count({
      where: { sequence: { lte: written[1].sequence } },
    });
    expect(remaining).toBe(0);

    const verification = await verifyAuditChain();
    expect(verification.valid).toBe(true);
    expect(verification.prunedSegments).toBe(1);
  });

  it("refuses the identical prune on the runtime connection", async () => {
    // FIRST, make sure there is genuinely something to prune. Without this the
    // call below returns `{ prunedCount: 0 }` before it reaches a single
    // DELETE, and the test would pass with no grants in place at all — the
    // exact vacuity this file exists to avoid. It failed that way twice while
    // being written, so the setup is deliberate rather than defensive:
    //
    //   - the trail is emptied, because retention prunes a contiguous PREFIX
    //     (D-168 rule 2), and the previous test left a checkpoint plus a newer
    //     `audit.retention_pruned` row in front of anything added here — so
    //     backdated rows behind it are not a prefix and nothing is deletable;
    //   - two of three rows are aged past the cutoff, so a prefix exists.
    await reset();

    const events = [];
    for (let index = 0; index < 3; index += 1) {
      events.push(
        await recordAuditEvent({
          eventType: `test.prune_denied_${index}`,
          outcome: "SUCCESS",
        }),
      );
    }
    await owner.auditEvent.updateMany({
      where: { sequence: { in: [events[0].sequence, events[1].sequence] } },
      data: { occurredAt: LONG_AGO },
    });

    // THE SAME FUNCTION, the same arguments, one different client. That is what
    // makes the test above a statement about the ROLE rather than about the
    // cutoff: if the grants were wrong, this would succeed.
    //
    // The refusal names `AuditCheckpoint`, not `AuditEvent`, and that is
    // correct rather than a near miss: the prune writes its checkpoint and
    // deletes the rows it accounts for in ONE transaction (D-168 rule 1), and
    // the INSERT comes first — so the runtime role is stopped one statement
    // before the delete it was heading for. Either table refusing is the
    // control working; asserting on the exact one would make this test a
    // statement about statement order.
    await expect(pruneAuditEventPrefix(CUTOFF, prisma)).rejects.toThrow(
      /permission denied for table Audit(Event|Checkpoint)/i,
    );

    // And it really was prunable — the retention role takes exactly the rows
    // the runtime role was refused.
    const outcome = await pruneAuditTrail(CUTOFF, "role_model_proof_denied");
    expect(outcome.prunedCount).toBe(2);
  });

  it("lets retention record its own run, which ADR-0002 §7.4 forgot", async () => {
    // §7.4 grants the retention role `SELECT, DELETE` and no INSERT — a role
    // that could delete audit rows and could not record having done so. The
    // prune above appended `audit.retention_pruned` through this connection, so
    // the grant is exercised rather than merely present.
    const recorded = await retention.auditEvent.findFirst({
      where: { eventType: "audit.retention_pruned" },
      select: { id: true },
    });
    expect(recorded).not.toBeNull();
  });

  it("does not let retention rewrite or truncate what it may delete", async () => {
    // Retention's DELETE is not general write access. It may remove a prefix
    // behind a checkpoint; it may not edit history, and it may not empty the
    // table in one statement outside the checkpointed path.
    await expect(
      retention.$executeRawUnsafe(`UPDATE "AuditEvent" SET reason = 'x'`),
    ).rejects.toThrow(/permission denied for table AuditEvent/i);

    await expect(
      retention.$executeRawUnsafe('TRUNCATE TABLE "AuditEvent"'),
    ).rejects.toThrow(/permission denied for table AuditEvent/i);

    // AuditCheckpoint is append-only for retention too (D-168 rule 3): it may
    // write a checkpoint and never edit or remove one.
    await expect(retention.auditCheckpoint.deleteMany({})).rejects.toThrow(
      /permission denied for table AuditCheckpoint/i,
    );
  });
});

/**
 * `audit:grants` — BOTH branches, against two real databases.
 *
 * The positive branch is easy and worth little on its own: a report that only
 * ever says "IN FORCE" would pass it. So the negative branch is proved by
 * building a database in which the runtime role really does own the audit
 * tables — the state every instance was in before this change — and running the
 * SAME function against it.
 */
describe("audit:grants tells the truth in both directions", () => {
  const SCRATCH = "splashtrack_grantcheck_test";
  let wrongWay: PrismaClient | undefined;

  function capture() {
    const lines: string[] = [];
    return {
      lines,
      ctx: {
        flags: {},
        positionals: [],
        log: (line: string) => void lines.push(line),
        error: (line: string) => void lines.push(line),
        emit: (line: string) => void lines.push(line),
      },
    };
  }

  function urlFor(base: string, database: string): string {
    const url = new URL(base);
    url.pathname = `/${database}`;
    return url.toString();
  }

  beforeAll(async () => {
    const maintenance = process.env.DATABASE_MAINTENANCE_URL as string;

    // A throwaway database, created by the retention role — the CREATEDB that
    // ADR-0002 §6 puts there and nowhere else.
    const admin = new Client({
      connectionString: urlFor(maintenance, "postgres"),
    });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
      // Owned by retention, so `afterAll` can drop it again.
      await admin.query(`CREATE DATABASE "${SCRATCH}"`);
    } finally {
      await admin.end();
    }

    // Let the runtime role create tables THERE — deliberately reproducing the
    // arrangement this ADR removes, so the report has something real to be
    // wrong about.
    await claimSchemaForOwner(
      urlFor(maintenance, SCRATCH),
      REFERENCE_OWNER_ROLE,
    );

    const asOwner = new Client({
      connectionString: migrationUrlFrom(
        urlFor(maintenance, SCRATCH),
        REFERENCE_OWNER_ROLE,
      ),
    });
    await asOwner.connect();
    try {
      await asOwner.query(
        `GRANT CREATE, USAGE ON SCHEMA public TO "${REFERENCE_APP_ROLE}"`,
      );
    } finally {
      await asOwner.end();
    }

    const asApp = new Client({
      connectionString: urlFor(process.env.DATABASE_URL as string, SCRATCH),
    });
    await asApp.connect();
    try {
      // Owned by the RUNTIME role, because it created them. That is exactly
      // what `prisma migrate deploy` used to do with every real table.
      await asApp.query(
        `CREATE TABLE "AuditEvent" ("id" text PRIMARY KEY, "sequence" serial)`,
      );
      await asApp.query(
        `CREATE TABLE "AuditCheckpoint" ("id" text PRIMARY KEY)`,
      );
      // And the revoke that LOOKS like the control, so the grant list is empty
      // and only the ownership check can tell the difference. This is the exact
      // state ADR-0002 §3 found: green grants over an absent control.
      await asApp.query(
        `REVOKE ALL ON TABLE "AuditEvent" FROM "${REFERENCE_APP_ROLE}"`,
      );
    } finally {
      await asApp.end();
    }

    wrongWay = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: urlFor(process.env.DATABASE_URL as string, SCRATCH),
      }),
    });
  });

  afterAll(async () => {
    await wrongWay?.$disconnect();
    const admin = new Client({
      connectionString: urlFor(
        process.env.DATABASE_MAINTENANCE_URL as string,
        "postgres",
      ),
    });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${SCRATCH}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  });

  it("reports IN FORCE on the provisioned database", async () => {
    const { lines, ctx } = capture();
    const code = await auditGrants(ctx);
    const output = lines.join("\n");

    expect(code).toBe(0);
    expect(output).toContain("D-149 part 2 is IN FORCE");
    expect(output).not.toContain("NOT in force");

    // The ownership line is part of the report and not a detail: the grant list
    // alone cannot distinguish "revoked" from "revoked and re-grantable".
    expect(output).toContain(`AuditEvent       ${REFERENCE_OWNER_ROLE}`);
    expect(output).toContain(`AuditEvent       ${REFERENCE_APP_ROLE}`);
  });

  it("reports NOT in force when ownership is put back the wrong way", async () => {
    const { lines, ctx } = capture();
    const code = await auditGrants(ctx, wrongWay as PrismaClient);
    const output = lines.join("\n");

    // Still exit 0 — it is a report, and the entrypoint must not refuse a start
    // over a deployment step. Loud, not fatal.
    expect(code).toBe(0);
    expect(output).toContain("NOT in force");
    expect(output).not.toContain("D-149 part 2 is IN FORCE");

    // And it says WHY, naming ownership rather than the grants — because the
    // grants here are exactly the ones the "in force" branch would accept.
    expect(output).toContain("OWNS");
    expect(output).toContain("re-grants them to itself in one statement");
    expect(output).toContain("ADR-0002");
  });
});
