import { afterAll, afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import { disconnectRoleClients, ownerClient } from "../support/database-roles";

/**
 * The PostgreSQL behaviour ADR-0002 §3's argument rests on, pinned so it stays a
 * fact the suite re-checks rather than a paragraph somebody believed.
 *
 * The argument: `infra/audit-database-role.sql` revokes `UPDATE`/`DELETE` on
 * `AuditEvent` from the application role, and `audit:grants` reported the
 * resulting empty grant list as "IN FORCE". Both are only true if that role is
 * not the table's OWNER, because an owner holds its privileges by ownership
 * rather than by grant and re-grants them to itself at will. The actor the
 * control names is an external SQL primitive — an injection, a stolen
 * `DATABASE_URL` — and a primitive that can issue `DELETE` can generally issue
 * `GRANT`.
 *
 * WHAT CHANGED IN THIS FILE WHEN THE ROLE MODEL LANDED, which is itself the
 * result. The first test used to create its probe table through the RUNTIME
 * client and assert that the runtime role therefore owned it — "which is
 * exactly what `prisma migrate deploy` does with every real table today". That
 * setup can no longer run: the runtime role has no `CREATE` on schema `public`
 * and cannot make a table to own. So the probe is created by the owner, and the
 * two halves of §3 are now asserted against the two different roles they are
 * about.
 */

const PROBE = "audit_ownership_probe";

const owner = ownerClient();

afterEach(async () => {
  await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE}"`);
});

afterAll(async () => {
  await disconnectRoleClients();
});

describe("audit table ownership (ADR-0002)", () => {
  it("gives the runtime role no way to become an owner", async () => {
    // The premise of the whole defect, gone: there is no longer a path by which
    // the role in `DATABASE_URL` comes to own anything, because it cannot
    // create anything. Every assertion below depends on this one.
    await expect(
      prisma.$executeRawUnsafe(`CREATE TABLE "${PROBE}" (id int)`),
    ).rejects.toThrow(/permission denied for schema public/i);

    const [{ role, superuser }] = await prisma.$queryRaw<
      { role: string; superuser: boolean }[]
    >`
      SELECT current_user AS role,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
               AS superuser
    `;

    // A superuser bypasses privilege checks outright, so every assertion in
    // this file — and every grant in the model — would be vacuous against one.
    // D-116, checked rather than assumed.
    expect(superuser).toBe(false);

    const owned = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_tables
       WHERE schemaname = current_schema() AND tableowner = ${role}
    `;
    expect(Number(owned[0].count)).toBe(0);
  });

  it("stops a non-owner from re-granting itself a revoked privilege", async () => {
    await owner.$executeRawUnsafe(`CREATE TABLE "${PROBE}" (id int)`);
    await owner.$executeRawUnsafe(`INSERT INTO "${PROBE}" VALUES (1)`);

    const [{ role }] = await prisma.$queryRaw<{ role: string }[]>`
      SELECT current_user AS role
    `;
    const [{ tableowner }] = await prisma.$queryRaw<{ tableowner: string }[]>`
      SELECT tableowner FROM pg_tables
       WHERE schemaname = current_schema() AND tablename = ${PROBE}
    `;
    expect(tableowner).not.toBe(role);

    // Granted, then revoked — the exact shape of §3 of the provisioning SQL.
    await owner.$executeRawUnsafe(`GRANT DELETE ON "${PROBE}" TO "${role}"`);
    await owner.$executeRawUnsafe(`REVOKE DELETE ON "${PROBE}" FROM "${role}"`);

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`),
    ).rejects.toThrow(/permission denied/i);

    // The half that used to fail. A non-owner's `GRANT` is not an error — it is
    // a WARNING and a no-op, which is worse than an error for anyone reading a
    // log — so the assertion is on the DELETE that follows it, not on the GRANT.
    await prisma
      .$executeRawUnsafe(`GRANT DELETE ON "${PROBE}" TO "${role}"`)
      .catch(() => undefined);

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "${PROBE}"`),
    ).rejects.toThrow(/permission denied/i);

    // And it cannot take the table instead of the privilege.
    await expect(
      prisma.$executeRawUnsafe(`ALTER TABLE "${PROBE}" OWNER TO "${role}"`),
    ).rejects.toThrow(/must be owner of (table|relation)/i);
  });

  it("still lets an OWNER re-grant itself, which is why ownership had to move", async () => {
    // The measurement ADR-0002 §3 quotes, re-run rather than cited. It is the
    // reason the whole change exists: with ownership where it used to be, the
    // revoke buys exactly one statement of delay.
    await owner.$executeRawUnsafe(`CREATE TABLE "${PROBE}" (id int)`);
    await owner.$executeRawUnsafe(`INSERT INTO "${PROBE}" VALUES (1)`);

    const [{ role }] = await owner.$queryRaw<{ role: string }[]>`
      SELECT current_user AS role
    `;

    await owner.$executeRawUnsafe(`REVOKE DELETE ON "${PROBE}" FROM "${role}"`);
    await owner.$executeRawUnsafe(`GRANT DELETE ON "${PROBE}" TO "${role}"`);

    const deleted = await owner.$executeRawUnsafe(`DELETE FROM "${PROBE}"`);
    expect(deleted).toBe(1);
  });
});
