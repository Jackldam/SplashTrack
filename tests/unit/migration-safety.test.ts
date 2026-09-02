import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ADOPTED FROM THE TEMPLATE AS-IS (D-135), and verified to do what
 * `05-technical.md` §5.1 claims: it blocks the unsafe `ADD COLUMN … NOT NULL`
 * without a default.
 *
 * The anti-pattern: an `ALTER TABLE … ADD COLUMN "x" <type> NOT NULL` with NO
 * `DEFAULT`. Prisma replays migrations on a FRESH database against empty
 * tables, so this succeeds locally and in CI — but on an incrementally-upgraded,
 * already-POPULATED database it fails with P3009 and blocks EVERY later
 * migration until an operator resolves it by hand.
 *
 * This is exactly the class of migration that strands an upgrade mid-flight,
 * and `06-delivery.md` §2.1 makes it a blocking check. It pairs with the
 * migrate-against-a-populated-database job, which catches what a regex cannot.
 *
 * The safe shapes are:
 *   - `ADD COLUMN "x" <type> NOT NULL DEFAULT <value>`, or
 *   - add the column NULLABLE, backfill it, then `ALTER COLUMN "x" SET NOT NULL`.
 */

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * Migrations that predate this guard and carry the risky pattern.
 *
 * EMPTY, and it must stay that way. The template shipped one entry, for a
 * migration of its own that this repository does not have — carrying it across
 * would have failed the second test below (which is the point of that test).
 * SplashTrack's migration history starts clean, so there is nothing to
 * grandfather. Do not add to this list: fix the migration instead.
 */
const ALLOWLIST = new Set<string>([]);

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
