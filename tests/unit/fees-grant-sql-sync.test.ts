import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  feesGrantStatements,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
} from "@/lib/database/role-model";

/**
 * `infra/fees-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the `exams-grant-sql-sync.test.ts` shape,
 * for the sixth append-only carve-out (phase 3.3), and the second with two
 * different shapes for its two tables. See that file's own comment for why
 * `Charge` differs from `Payment`.
 */

const SQL_PATH = join(process.cwd(), "infra", "fees-database-role.sql");

/** Executable statements only — comments and blank lines carry no grant. */
function statementsInFile(): string[] {
  return readFileSync(SQL_PATH, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .join(" ")
    .split(";")
    .map(normalise)
    .filter((statement) => statement.length > 0);
}

/** Collapses whitespace so formatting differences are not failures. */
function normalise(statement: string): string {
  return statement.replace(/\s+/g, " ").trim();
}

describe("infra/fees-database-role.sql (D-088/D-091/D-092, phase 3.3)", () => {
  const fromCode = feesGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("grants the runtime role UPDATE on Charge restricted to exactly the status/waive/cancel columns", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Charge"') &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    // One plain SELECT, INSERT grant, plus one column-restricted UPDATE grant.
    expect(runtimeGrants).toHaveLength(2);

    const plain = runtimeGrants.find((g) => !g.includes("UPDATE ("));
    const restricted = runtimeGrants.find((g) => g.includes("UPDATE ("));

    expect(plain).toBeDefined();
    expect(plain).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);

    expect(restricted).toBeDefined();
    expect(restricted).toContain(
      'UPDATE ("status", "waivedAt", "waivedReason", "waivedByPersonId", "cancelledAt", "cancelledReason", "cancelledByPersonId")',
    );
    // No unrestricted UPDATE anywhere, and no DELETE/TRUNCATE/ALL at all — in
    // particular, `amount`, `dueDate`, `feeTypeId` and `payerPersonId` are
    // never reachable by the runtime role's UPDATE.
    expect(restricted).not.toMatch(/\bUPDATE ON TABLE\b/);
    expect(restricted).not.toMatch(/DELETE|TRUNCATE|ALL/);
  });

  it("grants the retention role full UPDATE (sever) and DELETE (future prune) on Charge", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Charge"') &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(retentionGrants).toHaveLength(1);
    expect(retentionGrants[0]).toContain("UPDATE");
    expect(retentionGrants[0]).toContain("DELETE");
    expect(retentionGrants[0]).not.toMatch(/TRUNCATE|ALL|INSERT/);
  });

  it("never grants the runtime role a write on Payment beyond INSERT", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Payment"') &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    expect(runtimeGrants.length).toBeGreaterThan(0);
    for (const grant of runtimeGrants) {
      expect(grant).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);
    }
  });

  it("grants the retention role UPDATE (sever) and DELETE (future prune) on Payment", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Payment"') &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(retentionGrants).toHaveLength(1);
    expect(retentionGrants[0]).toContain("UPDATE");
    expect(retentionGrants[0]).toContain("DELETE");
    expect(retentionGrants[0]).not.toMatch(/TRUNCATE|ALL|INSERT/);
  });
});
