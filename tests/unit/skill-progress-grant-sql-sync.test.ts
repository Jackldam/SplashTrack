import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
  skillProgressGrantStatements,
} from "@/lib/database/role-model";

/**
 * `infra/skill-progress-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the exact `audit-grant-sql-sync` shape,
 * for the third append-only carve-out (phase 2.2's decision round, closing
 * the report's open item 6). The reasoning for keeping a readable SQL copy at
 * all lives in that test's header and applies here unchanged.
 */

const SQL_PATH = join(
  process.cwd(),
  "infra",
  "skill-progress-database-role.sql",
);

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

describe("infra/skill-progress-database-role.sql (D-005, phase 2.2 decision round)", () => {
  const fromCode = skillProgressGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("never grants the runtime role a write on SkillProgress beyond INSERT", () => {
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`TO "${REFERENCE_APP_ROLE}"`),
    );
    for (const grant of runtimeGrants) {
      expect(grant).not.toMatch(/UPDATE|DELETE|TRUNCATE|ALL/);
    }
  });

  it("gives the retention role UPDATE (the sever) and DELETE (retention), and no INSERT", () => {
    const retentionGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`TO "${REFERENCE_RETENTION_ROLE}"`),
    );
    expect(
      retentionGrants.some(
        (statement) =>
          statement.includes("UPDATE") && statement.includes("DELETE"),
      ),
    ).toBe(true);
    for (const grant of retentionGrants) {
      expect(grant).not.toMatch(/TRUNCATE|ALL|INSERT/);
    }
  });
});
