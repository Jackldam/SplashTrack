import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guardrail against the migration anti-pattern that froze UAT (see
 * documentation/database.md §4.1): an `ALTER TABLE ... ADD COLUMN "x" <type>
 * NOT NULL` with NO `DEFAULT`. Prisma replays migrations on a FRESH database
 * against empty tables, so this succeeds locally and in CI — but on an
 * incrementally-upgraded, already-populated environment (UAT, and any real
 * prod that has been live since the feature shipped) it fails with P3009 and
 * blocks EVERY later migration until an operator resolves it by hand.
 *
 * The safe shapes are:
 *   - `ADD COLUMN "x" <type> NOT NULL DEFAULT <value>`, or
 *   - add the column NULLABLE, backfill it, then `ALTER COLUMN "x" SET NOT NULL`.
 *
 * This test fails CI if a NEW migration ships the unsafe shape.
 */

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * Migrations that predate this guard and carry the risky pattern. They are
 * already applied everywhere, and a from-scratch deploy replays them on an EMPTY
 * table (safe); the one incrementally-upgraded environment that broke (UAT) was
 * remediated by hand (add-nullable → backfill → set-not-null). Listed here so the
 * guard blocks only NEW occurrences. Do not add to this list — fix the migration.
 */
const ALLOWLIST = new Set(["20260722105628_credential_role_assignment_unit"]);

/** `ADD COLUMN "col" <type> ... NOT NULL` — the ALTER TABLE add (NOT a CREATE
 * TABLE column, which never says "ADD COLUMN", and NOT `ALTER COLUMN ... SET NOT
 * NULL`, which is the safe backfill step). DEFAULT is checked separately. */
const ADD_NOT_NULL = /ADD COLUMN\s+"[^"]+"\s+.+?\bNOT NULL\b/i;

function migrationDirs(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

describe("migration safety", () => {
  it("no NEW migration adds a NOT NULL column to an existing table without a DEFAULT", () => {
    const violations: string[] = [];
    for (const dir of migrationDirs()) {
      if (ALLOWLIST.has(dir)) continue;
      const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
      if (!existsSync(sqlPath)) continue;
      readFileSync(sqlPath, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (ADD_NOT_NULL.test(line) && !/\bDEFAULT\b/i.test(line)) {
            violations.push(
              `${dir}/migration.sql:${index + 1}  ${line.trim()}`,
            );
          }
        });
    }
    expect(
      violations,
      "Adding a NOT NULL column to a table that may hold rows fails on a populated " +
        "database (Prisma P3009). Add it NULLABLE, backfill, then `ALTER COLUMN ... " +
        "SET NOT NULL` — or give it a DEFAULT. See documentation/database.md §4.1.\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("keeps the allowlist tight (every allowlisted migration still exists)", () => {
    const dirs = new Set(migrationDirs());
    for (const allowed of ALLOWLIST) {
      expect(
        dirs.has(allowed),
        `allowlisted migration "${allowed}" not found — remove the stale entry`,
      ).toBe(true);
    }
  });
});
