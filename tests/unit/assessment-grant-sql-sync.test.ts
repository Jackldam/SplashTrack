import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assessmentGrantStatements,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
} from "@/lib/database/role-model";

/**
 * `infra/assessment-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the exact `attendance-grant-sql-sync` /
 * `skill-progress-grant-sql-sync` shape, for the third append-only carve-out
 * (phase 2.3), this time built from the start rather than retrofitted.
 */

const SQL_PATH = join(process.cwd(), "infra", "assessment-database-role.sql");

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

describe("infra/assessment-database-role.sql (D-005/D-085/D-087, phase 2.3)", () => {
  const fromCode = assessmentGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("never grants the runtime role a write on any of the three tables beyond INSERT", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    expect(runtimeGrants.length).toBeGreaterThan(0);
    for (const grant of runtimeGrants) {
      expect(grant).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);
    }
  });

  it("gives the retention role UPDATE (sever) and DELETE (future prune) on all three tables", () => {
    for (const table of [
      "Assessment",
      "AssessmentCriterionResult",
      "CriterionWaiver",
    ]) {
      const retentionGrants = fromCode.filter(
        (statement) =>
          statement.startsWith("GRANT") &&
          statement.includes(`ON TABLE "${table}"`) &&
          statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
      );
      expect(retentionGrants, table).toHaveLength(1);
      expect(retentionGrants[0]).toContain("UPDATE");
      expect(retentionGrants[0]).toContain("DELETE");
      expect(retentionGrants[0]).not.toMatch(/TRUNCATE|ALL|INSERT/);
    }
  });
});
