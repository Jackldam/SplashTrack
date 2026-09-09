import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  auditGrantStatements,
  REFERENCE_APP_ROLE,
  REFERENCE_OWNER_ROLE,
  REFERENCE_RETENTION_ROLE,
} from "@/lib/database/role-model";

/**
 * `infra/audit-database-role.sql` stays in sync with the statements
 * `db:apply-grants` actually runs — the bidirectional shape this repository
 * already uses for `data-class-registry-sync` and `person-reference-sync`.
 *
 * WHY A SECOND COPY EXISTS AT ALL. The SQL file is what an operator on a
 * managed database reads to see the control, and what an auditor reads to
 * answer "is the audit trail append-only on this instance?". A command is not
 * readable that way. But a documentation copy that drifts from the code is
 * worse than no copy: it would describe a control the instance does not have,
 * which is the same reassuring-direction wrongness ADR-0002 §3 is about, one
 * level up. This test is the only reason keeping both is safe.
 */

const SQL_PATH = join(process.cwd(), "infra", "audit-database-role.sql");

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

describe("infra/audit-database-role.sql (ADR-0002)", () => {
  const fromCode = auditGrantStatements({
    owner: REFERENCE_OWNER_ROLE,
    app: REFERENCE_APP_ROLE,
    retention: REFERENCE_RETENTION_ROLE,
  }).map(normalise);

  it("contains exactly the statements db:apply-grants runs, in the same order", () => {
    expect(statementsInFile()).toEqual(fromCode);
  });

  it("never grants the runtime role a write on AuditEvent", () => {
    // The property, checked independently of the equality above: if someone
    // changes BOTH sides in the same commit, this still fails.
    const runtimeGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes(`"${REFERENCE_APP_ROLE}"`) &&
        statement.includes('"AuditEvent"'),
    );

    expect(runtimeGrants).not.toHaveLength(0);
    for (const statement of runtimeGrants) {
      expect(statement).not.toMatch(/\bUPDATE\b/);
      expect(statement).not.toMatch(/\bDELETE\b/);
      expect(statement).not.toMatch(/\bTRUNCATE\b/);
    }
  });

  it("revokes with ALL rather than naming privileges, so TRUNCATE is covered", () => {
    const revokes = fromCode.filter((statement) =>
      statement.startsWith("REVOKE"),
    );
    expect(revokes).not.toHaveLength(0);
    for (const statement of revokes) {
      expect(statement).toMatch(/^REVOKE ALL ON TABLE/);
    }
  });

  it("gives DELETE on AuditEvent to the retention role and to nobody else", () => {
    const deleters = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('"AuditEvent"') &&
        /\bDELETE\b/.test(statement),
    );
    expect(deleters).toHaveLength(1);
    expect(deleters[0]).toContain(`"${REFERENCE_RETENTION_ROLE}"`);
  });

  it("leaves AuditCheckpoint append-only for every role (D-168 rule 3)", () => {
    const checkpointGrants = fromCode.filter(
      (statement) =>
        statement.startsWith("GRANT") &&
        statement.includes('"AuditCheckpoint"'),
    );
    expect(checkpointGrants).not.toHaveLength(0);
    for (const statement of checkpointGrants) {
      expect(statement).not.toMatch(/\bUPDATE\b/);
      expect(statement).not.toMatch(/\bDELETE\b/);
    }
  });
});
