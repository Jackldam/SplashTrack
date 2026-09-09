import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  attendanceGrantStatements,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
} from "@/lib/database/role-model";

/**
 * `infra/attendance-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the exact `audit-grant-sql-sync` shape,
 * for the second append-only carve-out (phase 2.2). The reasoning for keeping
 * a readable SQL copy at all lives in that test's header and applies here
 * unchanged.
 */

const SQL_PATH = join(process.cwd(), "infra", "attendance-database-role.sql");

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

describe("infra/attendance-database-role.sql (D-005/D-061, phase 2.2)", () => {
  const fromCode = attendanceGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("never grants the runtime role a write on AttendanceEvent beyond INSERT", () => {
    // The property, checked independently of the equality above: if someone
    // changes BOTH sides in the same commit, this still fails.
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    for (const grant of runtimeGrants) {
      expect(grant).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);
    }
  });

  it("gives the retention role DELETE (D-111) and nothing that rewrites", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(
      retentionGrants.some((statement) => statement.includes("DELETE")),
    ).toBe(true);
    for (const grant of retentionGrants) {
      expect(grant).not.toMatch(/UPDATE|TRUNCATE|ALL|INSERT/);
    }
  });
});
