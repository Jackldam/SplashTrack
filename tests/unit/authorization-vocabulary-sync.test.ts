import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HIGH_RISK_PERMISSIONS,
  HIGH_RISK_PREFIXES,
  PERMISSIONS,
  SCOPE_TYPES,
  SELF_PERMISSIONS,
} from "@/lib/authorization";

/**
 * Two vocabularies that exist in two places, kept in step by a test rather than
 * by discipline.
 *
 *   1. `ScopeType` — the Prisma enum and the TypeScript union. A member in one
 *      and not the other is a grant the database accepts and `resolveReach`
 *      silently ignores, which is the failure mode D-147 makes a compile error
 *      everywhere else.
 *   2. The permission catalogue — `@/lib/authorization/permissions` and
 *      `02-security-privacy.md` §2.5. §2.5 states the rule this makes
 *      mechanical: *a permission referenced anywhere in the design set and
 *      absent here is a defect, not a shorthand.* That rule is how
 *      `roles.assign` came to be cited as high-risk in `07-operations.md` §1.3
 *      while existing nowhere (F-109).
 *
 * Both parse the source of truth directly, so they fail in EITHER direction.
 */

const repoRoot = process.cwd();

function readSchema(): string {
  return readFileSync(join(repoRoot, "prisma", "schema.prisma"), "utf-8");
}

function readSecurityChapter(): string {
  return readFileSync(
    join(repoRoot, "docs", "design", "02-security-privacy.md"),
    "utf-8",
  );
}

/** The members of a named Prisma enum, ignoring doc comments and blank lines. */
function prismaEnumMembers(schema: string, name: string): string[] {
  const start = new RegExp(`enum\\s+${name}\\s*\\{`).exec(schema);
  if (!start) throw new Error(`enum ${name} not found in prisma/schema.prisma`);
  const bodyStart = start.index + start[0].length;
  const end = schema.indexOf("}", bodyStart);
  return schema
    .slice(bodyStart, end)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("//") && !line.startsWith("///"),
    );
}

/**
 * The keys inside §2.5's fenced block. A "key" is a dotted lowercase token, so
 * the prose in that block — `(special category — separately gated)` — is
 * ignored without needing a list of exceptions.
 */
function designPermissionKeys(chapter: string): Set<string> {
  const section = chapter.slice(
    chapter.indexOf("### 2.5 Permission catalogue"),
  );
  const fenceStart = section.indexOf("```text");
  const fenceEnd = section.indexOf("```", fenceStart + 7);
  if (fenceStart < 0 || fenceEnd < 0) {
    throw new Error(
      "§2.5's permission block was not found — has the chapter moved?",
    );
  }
  const block = section.slice(fenceStart + 7, fenceEnd);
  const keys = block.match(/\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\b/g) ?? [];
  return new Set(keys);
}

describe("ScopeType is one set, in the schema and in the code", () => {
  const schemaMembers = prismaEnumMembers(readSchema(), "ScopeType");

  it("parsed the enum at all (sanity check the parser, not the schema)", () => {
    expect(schemaMembers.length).toBeGreaterThanOrEqual(6);
  });

  it("matches @/lib/authorization/scope exactly, in both directions", () => {
    expect([...schemaMembers].sort()).toEqual([...SCOPE_TYPES].sort());
  });

  it("does NOT contain RELATED (OD-5, D-161)", () => {
    // It was simultaneously mandated for v1, deferred to the guardian portal,
    // and granted by the starter-role catalogue — an administrator could assign
    // a scope whose enforcement nobody had written, and it would look like it
    // worked. The member returns with the portal that needs it.
    expect(schemaMembers).not.toContain("RELATED");
    expect(SCOPE_TYPES as readonly string[]).not.toContain("RELATED");
  });
});

describe("the permission catalogue matches 02-security-privacy.md §2.5", () => {
  const designKeys = designPermissionKeys(readSecurityChapter());

  it("parsed the design block at all", () => {
    expect(designKeys.size).toBeGreaterThan(40);
    expect(designKeys.has("students.medical.read")).toBe(true);
    expect(designKeys.has("roles.assign")).toBe(true);
  });

  it("defines every key the design catalogue lists", () => {
    const missing = [...designKeys].filter(
      (key) => !PERMISSIONS.has(key as never),
    );
    expect(
      missing,
      `${missing.join(", ")} appear in §2.5's catalogue and not in ` +
        "src/lib/authorization/permissions.ts. A permission the guard cannot " +
        "name is a check that never matches a row — which DENIES, silently, " +
        "until the day somebody needs it.",
    ).toEqual([]);
  });

  it("defines no key the design catalogue does not list", () => {
    const extra = [...PERMISSIONS].filter((key) => !designKeys.has(key));
    expect(
      extra,
      `${extra.join(", ")} are defined in code and absent from §2.5. §2.5 is ` +
        "the catalogue; a key invented in code is a permission with no stated " +
        "meaning and no place in the starter-role catalogue.",
    ).toEqual([]);
  });
});

describe("the two closed subsets", () => {
  it("expands every wildcard §1.2 states, so adding a key under one goes RED", () => {
    // §1.2 names `privacy.*`, `backup.*` and `students.medical.*`. A runtime
    // prefix match would silently absorb every future key beginning with those
    // words, which is the wrong direction of surprise for a set whose
    // membership compels MFA.
    for (const prefix of HIGH_RISK_PREFIXES) {
      const underPrefix = [...PERMISSIONS].filter((key) =>
        key.startsWith(prefix),
      );
      expect(underPrefix.length).toBeGreaterThan(0);
      const unlisted = underPrefix.filter(
        (key) => !HIGH_RISK_PERMISSIONS.has(key),
      );
      expect(
        unlisted,
        `${unlisted.join(", ")} sit(s) under the high-risk prefix "${prefix}" ` +
          "and is/are not in HIGH_RISK_PERMISSIONS. §1.2 makes MFA mandatory " +
          "for the whole prefix; add the key or change the prefix list " +
          "deliberately.",
      ).toEqual([]);
    }
  });

  it("keeps every high-risk key inside the catalogue", () => {
    const unknown = [...HIGH_RISK_PERMISSIONS].filter(
      (key) => !PERMISSIONS.has(key),
    );
    expect(unknown).toEqual([]);
  });

  it("keeps the SELF set closed, catalogued and free of anything about another person", () => {
    const unknown = [...SELF_PERMISSIONS].filter(
      (key) => !PERMISSIONS.has(key),
    );
    expect(unknown).toEqual([]);

    // D-146: never medical, never notes, never anything about another person.
    for (const key of SELF_PERMISSIONS) {
      expect(key.startsWith("students.medical."), key).toBe(false);
      expect(key.startsWith("students.notes."), key).toBe(false);
    }
    // And nothing in it may be high-risk — a set granted to every account at
    // creation cannot contain a permission that compels MFA.
    const overlap = [...SELF_PERMISSIONS].filter((key) =>
      HIGH_RISK_PERMISSIONS.has(key),
    );
    expect(overlap).toEqual([]);
  });
});
