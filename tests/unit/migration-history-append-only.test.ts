import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * D-048 IS ENFORCED BY NOTHING — THE TEST THAT FIXES THAT.
 * `06-delivery.md` §2.2.
 *
 * D-048 says migration chains are never squashed within a major version. That
 * is a sentence in a document until something breaks a red build over it.
 * Two independent assertions, in the style `migration-safety.test.ts` already
 * uses:
 *
 *   1. The set of migration names at the LAST RELEASE TAG is a SUBSET of the
 *      set at HEAD — nothing may disappear.
 *   2. No APPLIED migration's SQL content hash has changed, checked against a
 *      committed `prisma/migrations/.lockfile.json`.
 *
 * Squashing or editing an applied migration is then a red build rather than a
 * self-hoster's old backup silently failing to restore two years later.
 *
 * OPEN POINT, flagged rather than guessed past: `06-delivery.md` §1 states
 * plainly "there are zero prior releases" (D-047's context, true here too —
 * `git tag` on this repository returns no semver release tag as of this
 * commit). The design does not say what assertion (1) should do before a
 * first release tag exists. This test treats "no release tag found" as
 * vacuously satisfied and SKIPS assertion (1) rather than failing the build
 * on a repository that has never shipped — the same posture `migration-safety
 * .test.ts` takes for its (currently empty) allowlist. The moment a release
 * tag lands, this test starts enforcing the subset rule against it
 * automatically; nothing further needs to change here. Jack should confirm
 * this is the intended behaviour before the first release tag is cut.
 */

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const LOCKFILE_PATH = join(MIGRATIONS_DIR, ".lockfile.json");

function migrationDirs(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Semantic-version-ish release tags, e.g. `v1.2.0` or `1.2.0`. Anything else
 * (branch-name tags, rescue markers, etc.) is not a release and is ignored —
 * this repository's only current tag, `rescue-build-head`, is exactly such a
 * non-release marker. */
const RELEASE_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

function latestReleaseTag(): string | null {
  let tags: string[];
  try {
    tags = execFileSync("git", ["tag", "-l"], { encoding: "utf8" })
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
  const releases = tags
    .map((tag) => {
      const match = RELEASE_TAG.exec(tag);
      if (!match) return null;
      const [, major, minor, patch] = match;
      return { tag, order: [Number(major), Number(minor), Number(patch)] };
    })
    .filter((entry): entry is { tag: string; order: number[] } => entry !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.order[i] !== b.order[i]) return a.order[i] - b.order[i];
      }
      return 0;
    });
  return releases.length > 0 ? releases[releases.length - 1].tag : null;
}

function migrationDirsAtTag(tag: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", tag, "--", "prisma/migrations"],
    { encoding: "utf8" },
  );
  const names = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /^prisma\/migrations\/([^/]+)\//.exec(line.trim());
    if (match) names.add(match[1]);
  }
  return [...names];
}

describe("migration history is append-only (D-048, 06-delivery.md §2.2)", () => {
  it("the migrations present at the last release tag are a subset of HEAD's", () => {
    const tag = latestReleaseTag();
    if (tag === null) {
      // No release has ever shipped (06-delivery.md §1: "there are zero
      // prior releases"). There is nothing yet for HEAD to have dropped, so
      // this is vacuously true rather than a build we can't ship a first
      // release from. See the open point in the file header.
      expect(tag).toBeNull();
      return;
    }
    const atTag = migrationDirsAtTag(tag);
    const atHead = new Set(migrationDirs());
    const dropped = atTag.filter((name) => !atHead.has(name));
    expect(
      dropped,
      `${dropped.join(", ")}\n\nThese migrations existed at release tag ` +
        `"${tag}" and are gone at HEAD. D-048: migration chains are never ` +
        "squashed within a major version — a self-hoster upgrading from that " +
        "release replays every migration in between.",
    ).toEqual([]);
  });

  it("no applied migration's SQL content hash has changed, per prisma/migrations/.lockfile.json", () => {
    expect(
      existsSync(LOCKFILE_PATH),
      "prisma/migrations/.lockfile.json is missing. It must be committed " +
        "alongside the migrations it hashes — run the generator and commit " +
        "the result.",
    ).toBe(true);

    const lockfile: Record<string, string> = JSON.parse(
      readFileSync(LOCKFILE_PATH, "utf8"),
    );

    const dirs = migrationDirs();
    const changed: string[] = [];
    const missingFromLockfile: string[] = [];
    const missingFromDisk: string[] = [];

    for (const dir of dirs) {
      const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
      if (!existsSync(sqlPath)) continue;
      const hash = createHash("sha256")
        .update(readFileSync(sqlPath, "utf8"))
        .digest("hex");
      const locked = lockfile[dir];
      if (locked === undefined) {
        missingFromLockfile.push(dir);
      } else if (locked !== hash) {
        changed.push(dir);
      }
    }

    for (const dir of Object.keys(lockfile)) {
      if (!dirs.includes(dir)) missingFromDisk.push(dir);
    }

    expect(
      changed,
      `${changed.join(", ")}\n\nThe SQL content of these applied migrations no ` +
        "longer matches prisma/migrations/.lockfile.json. Editing an applied " +
        "migration is silent, unrecoverable drift for anyone who already ran " +
        "it — add a NEW migration instead. If this is a genuinely new " +
        "migration, add it to the lockfile in the same commit rather than " +
        "editing an existing entry.",
    ).toEqual([]);

    expect(
      missingFromLockfile,
      `${missingFromLockfile.join(", ")}\n\nThese migrations are not in ` +
        "prisma/migrations/.lockfile.json. Add their content hash in the same " +
        "commit that adds the migration.",
    ).toEqual([]);

    expect(
      missingFromDisk,
      `${missingFromDisk.join(", ")}\n\nprisma/migrations/.lockfile.json has ` +
        "entries for migrations that no longer exist on disk. D-048 forbids " +
        "removing an applied migration — if this is intentional cleanup of a " +
        "migration that was never released, remove the matching lockfile " +
        "entry in the same commit.",
    ).toEqual([]);
  });
});
