import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  examsGrantStatements,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
} from "@/lib/database/role-model";

/**
 * `infra/exams-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the `assessment-grant-sql-sync` shape,
 * for the fifth append-only carve-out (phase 2.4), and the first with two
 * different shapes for its two tables. See that file's own comment for why
 * `Award` differs from `ExamResult`.
 */

const SQL_PATH = join(process.cwd(), "infra", "exams-database-role.sql");

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

describe("infra/exams-database-role.sql (D-062/D-085/D-089, phase 2.4)", () => {
  const fromCode = examsGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("never grants the runtime role a write on ExamResult beyond INSERT", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "ExamResult"') &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    expect(runtimeGrants.length).toBeGreaterThan(0);
    for (const grant of runtimeGrants) {
      expect(grant).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);
    }
  });

  it("grants the retention role UPDATE (sever) and DELETE (future prune) on ExamResult", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "ExamResult"') &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(retentionGrants).toHaveLength(1);
    expect(retentionGrants[0]).toContain("UPDATE");
    expect(retentionGrants[0]).toContain("DELETE");
    expect(retentionGrants[0]).not.toMatch(/TRUNCATE|ALL|INSERT/);
  });

  it("grants the runtime role UPDATE on Award restricted to exactly revokedAt/revokeReason", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Award"') &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    // One plain SELECT, INSERT grant, plus one column-restricted UPDATE grant.
    expect(runtimeGrants).toHaveLength(2);

    const plain = runtimeGrants.find((g) => !g.includes("UPDATE ("));
    const restricted = runtimeGrants.find((g) => g.includes("UPDATE ("));

    expect(plain).toBeDefined();
    expect(plain).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);

    expect(restricted).toBeDefined();
    expect(restricted).toContain('UPDATE ("revokedAt", "revokeReason")');
    // No unrestricted UPDATE anywhere, and no DELETE/TRUNCATE/ALL at all.
    expect(restricted).not.toMatch(/\bUPDATE ON TABLE\b/);
    expect(restricted).not.toMatch(/DELETE|TRUNCATE|ALL/);
  });

  it("grants the retention role full UPDATE (sever) and DELETE (future prune) on Award", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('ON TABLE "Award"') &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(retentionGrants).toHaveLength(1);
    expect(retentionGrants[0]).toContain("UPDATE");
    expect(retentionGrants[0]).toContain("DELETE");
    expect(retentionGrants[0]).not.toMatch(/TRUNCATE|ALL|INSERT/);
  });
});
