import { afterEach, describe, expect, it } from "vitest";

import { auditGrants } from "@/cli/commands/audit";
import { prisma } from "@/lib/database";

/**
 * The precondition D-149 part 2 depends on and never stated: the application
 * role must not OWN the audit tables (ADR-0002).
 *
 * `infra/audit-database-role.sql` §3 revokes `UPDATE`/`DELETE` on `AuditEvent`
 * from the application role, and `audit:grants` reported the resulting empty
 * grant list as "IN FORCE". Both are correct only if the role is not the
 * table's owner, because an owner holds its privileges by OWNERSHIP rather
 * than by grant and re-grants them to itself at will.
 *
 * The actor the control names is an external SQL primitive — an injection, a
 * stolen `DATABASE_URL`. A primitive that can issue `DELETE` can generally
 * issue `GRANT`, so against that actor a revoke against the owner buys one
 * statement of delay while reading as though it buys the property.
 *
 * The first test pins that Postgres behaviour so the claim is a fact the suite
 * re-checks rather than a paragraph in an ADR. The second pins the reporting
 * consequence: with the application role owning the table — which is the state
 * of every instance today, because `prisma migrate deploy` runs as the role in
 * `DATABASE_URL` — the report must NOT say the separation is in force.
 */

const PROBE = "audit_ownership_probe";

afterEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`);
});

function capture(): {
  lines: string[];
  ctx: Parameters<typeof auditGrants>[0];
} {
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

describe("audit table ownership (ADR-0002)", () => {
  it("cannot be held by a REVOKE while the app role is a superuser or the owner", async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE "${PROBE}" (id int)`);
    await prisma.$executeRawUnsafe(`INSERT INTO "${PROBE}" VALUES (1)`);

    const [{ role, superuser }] = await prisma.$queryRaw<
      { role: string; superuser: boolean }[]
    >`
      SELECT current_user AS role,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
               AS superuser
    `;
    const [{ owner }] = await prisma.$queryRaw<{ owner: string }[]>`
      SELECT tableowner AS owner FROM pg_tables
       WHERE schemaname = current_schema() AND tablename = ${PROBE}
    `;
    // The premise: the connection that created the table owns it — which is
    // exactly what `prisma migrate deploy` does with every real table today.
    expect(owner).toBe(role);

    await prisma.$executeRawUnsafe(
      `REVOKE DELETE ON "${PROBE}" FROM "${role}"`,
    );

    if (superuser) {
      // The WORSE of the two failures, and the state the reference compose
      // produces today: `POSTGRES_USER` is created by the Postgres image as a
      // SUPERUSER, and a superuser bypasses privilege checks outright. The
      // revoke is not weak here — it is inert. `audit:grants` must never call
      // this "in force".
      const deleted = await prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`);
      expect(deleted).toBe(1);
    } else {
      // A non-superuser OWNER. The revoke bites a bare DELETE — this half of
      // the control is real…
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`),
      ).rejects.toThrow(/permission denied/i);

      // …and the owner undoes it in one statement, which is the half that is
      // not. An injection that can DELETE can generally GRANT.
      await prisma.$executeRawUnsafe(`GRANT DELETE ON "${PROBE}" TO "${role}"`);
      const deleted = await prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`);
      expect(deleted).toBe(1);
    }
  });

  it("does not report D-149 part 2 as in force while the app role owns the audit tables", async () => {
    const { lines, ctx } = capture();
    const code = await auditGrants(ctx);
    const output = lines.join("\n");

    expect(code).toBe(0);

    // The owner is part of the report, not a detail: the grant list alone
    // cannot distinguish "revoked" from "revoked and re-grantable".
    expect(output).toContain("Owner of the audit tables:");
    expect(output).toMatch(/AuditEvent\s+\w+/);

    const [{ role }] = await prisma.$queryRaw<{ role: string }[]>`
      SELECT current_user AS role
    `;
    const owners = await prisma.$queryRaw<{ owner: string }[]>`
      SELECT tableowner AS owner FROM pg_tables
       WHERE schemaname = current_schema() AND tablename = 'AuditEvent'
    `;

    if (owners[0]?.owner === role) {
      expect(output).toContain("NOT in force");
      expect(output).not.toContain("is IN FORCE");
    } else {
      // A deployment that already followed ADR-0002. The report may legitimately
      // say the separation holds — but only because ownership is elsewhere.
      expect(output).not.toContain("OWNS");
    }
  });
});
