import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENCRYPTED_COLUMNS } from "@/lib/crypto";

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

/**
 * THE SECOND ASSERTION, ADDED IN PHASE 0.4a (D-167, `05-technical.md` §5 rule 6).
 *
 * A migration that touches a table carrying a registered encrypted column must
 * declare which of the two cases it is. The rule itself is narrow and stated
 * once in `13-configuration-and-setup.md` §5.1.1:
 *
 *   - **name-only** — a rename. Safe BY CONSTRUCTION, because the AAD binds a
 *     stable `columnId` from the registry, never the physical name. Update the
 *     registry entry's `model`/`field`; touch no ciphertext.
 *   - **key-changing** — the migration changes a row's primary key, splits a
 *     table, or moves an encrypted value into another row. The primary key IS
 *     in the AAD, so every affected value must be decrypted with the old
 *     `(columnId, pk)` and re-encrypted with the new one INSIDE THIS MIGRATION.
 *
 * Getting the second case wrong is silent, unrecoverable data loss that reports
 * itself as corruption — and R-20 runs migrations unattended at container
 * start, after the pre-migration backup, so neither the backup nor the running
 * instance can read the column afterwards.
 *
 * The design says the declaration belongs in the PR description, "because that
 * is where it will be checked". A test cannot read a PR, so the declaration
 * lives where a test can: a comment line in the migration SQL, which the PR
 * diff shows anyway.
 *
 *     -- ENCRYPTED-COLUMN-IMPACT: name-only
 *     -- ENCRYPTED-COLUMN-IMPACT: key-changing
 *
 * NO PRODUCTION COLUMN IS REGISTERED YET, so this currently matches nothing.
 * That is the ordering `CLAUDE.md` rule 1 asks for: the guard exists before the
 * first encrypted byte, not after the first migration that moves one.
 */
describe("migrations touching an encrypted column declare their impact (D-167)", () => {
  const DECLARATION =
    /--\s*ENCRYPTED-COLUMN-IMPACT:\s*(name-only|key-changing)/i;

  /** Models carrying at least one registered, non-fixture encrypted column. */
  const protectedModels = [
    ...new Set(
      Object.values(ENCRYPTED_COLUMNS)
        .filter((entry) => !entry.fixture)
        .map((entry) => entry.model),
    ),
  ];

  it("declares the impact wherever a protected table is touched", () => {
    if (protectedModels.length === 0) {
      // Nothing to check yet, and saying so beats a green test that silently
      // asserts nothing once the first column lands.
      expect(protectedModels).toEqual([]);
      return;
    }

    const undeclared: string[] = [];
    for (const dir of migrationDirs()) {
      const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
      if (!existsSync(sqlPath)) continue;
      const sql = readFileSync(sqlPath, "utf8");
      const touched = protectedModels.filter((model) =>
        new RegExp(`"${model}"`).test(sql),
      );
      if (touched.length > 0 && !DECLARATION.test(sql)) {
        undeclared.push(`${dir}/migration.sql (touches ${touched.join(", ")})`);
      }
    }

    expect(
      undeclared,
      `${undeclared.join("\n")}\n\nEach of these touches a table holding an ` +
        "encrypted column and does not say which case it is. Add one line to " +
        "the migration SQL:\n" +
        "  -- ENCRYPTED-COLUMN-IMPACT: name-only     (a rename; nothing to do)\n" +
        "  -- ENCRYPTED-COLUMN-IMPACT: key-changing  (primary keys move; this " +
        "migration re-encrypts)\n" +
        "See docs/design/13-configuration-and-setup.md §5.1.1.",
    ).toEqual([]);
  });
});
