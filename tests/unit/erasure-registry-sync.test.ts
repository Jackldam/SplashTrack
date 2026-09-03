import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ERASURE_REGISTRY,
  type ErasureRegistryEntry,
} from "@/lib/retention/erasure-registry";

import { extractModelBlocks } from "./prisma-schema-parser";

/**
 * The D-014/D-154 erasure registry's completeness test: every model
 * referencing `Person` has an entry, of either kind (`erase` or `exempt`).
 *
 * Field-level detection matches `person-reference-sync.test.ts` exactly (a
 * `*personId` scalar, or a `Person`/`Person?` relation field), but this test
 * groups the result by MODEL — `ERASURE_REGISTRY` is a table-level registry,
 * not a column-level one (see the file's own doc comment for why the two are
 * different axes).
 */

function modelsReferencingPerson(schema: string): Set<string> {
  const referencing = new Set<string>();
  for (const [model, body] of extractModelBlocks(schema)) {
    const hasPersonIdScalar = /^\s*\w*[Pp]ersonId\s+String\b/m.test(body);
    const hasPersonRelation = /^\s*\w+\s+Person\??\s+@relation\(/m.test(body);
    if (hasPersonIdScalar || hasPersonRelation) referencing.add(model);
  }
  return referencing;
}

/** The completeness check itself, factored out so its non-vacuousness (below) tests the SAME logic the real suite runs, not a re-implementation of it. */
function findMissingEntries(
  referencingModels: ReadonlySet<string>,
  registry: Readonly<Record<string, ErasureRegistryEntry>>,
): string[] {
  return [...referencingModels].filter((model) => !(model in registry));
}

describe("ERASURE_REGISTRY completeness (D-014, D-154)", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf-8",
  );
  const referencing = modelsReferencingPerson(schema);

  it("found at least one Person-referencing model (sanity check the parser)", () => {
    expect(referencing.size).toBeGreaterThan(3);
    expect(referencing.has("UserAccount")).toBe(true);
    expect(referencing.has("AuditEvent")).toBe(true);
  });

  it("has an entry — erase or exempt — for every Person-referencing model", () => {
    const missing = findMissingEntries(referencing, ERASURE_REGISTRY);
    expect(
      missing,
      `${missing.join(", ")} reference(s) Person in prisma/schema.prisma but ` +
        "have no entry in ERASURE_REGISTRY (src/lib/retention/erasure-registry.ts). " +
        "D-014 requires every such table to be registered; D-154 requires the " +
        "entry to be 'erase' or a named, dated 'exempt' — never an absence.",
    ).toEqual([]);
  });

  it("lists no entry for a model that no longer references Person", () => {
    const stale = Object.keys(ERASURE_REGISTRY).filter(
      (model) => !referencing.has(model),
    );
    expect(
      stale,
      `${stale.join(", ")} is/are registered in ERASURE_REGISTRY but no ` +
        "longer reference Person in prisma/schema.prisma - remove the stale " +
        "entry.",
    ).toEqual([]);
  });

  it("the completeness check is NON-VACUOUS: deleting a real entry is caught", () => {
    // Proves findMissingEntries actually detects an absence rather than
    // trivially passing. Strip one known-present entry (AuditEvent, the one
    // D-154 exists to keep from being silently exempted-by-omission) from a
    // COPY of the real registry and assert the check goes red for exactly it.
    const withoutAuditEvent = { ...ERASURE_REGISTRY };
    delete (withoutAuditEvent as Record<string, ErasureRegistryEntry>)
      .AuditEvent;

    const missing = findMissingEntries(referencing, withoutAuditEvent);
    expect(missing).toEqual(["AuditEvent"]);
  });

  it("every exempt entry states a non-empty ground and a non-empty expiry", () => {
    const malformed = Object.entries(ERASURE_REGISTRY)
      .filter(([, entry]) => entry.kind === "exempt")
      .filter(([, entry]) => {
        const exempt = entry as Extract<
          ErasureRegistryEntry,
          { kind: "exempt" }
        >;
        return (
          exempt.ground.trim().length === 0 || exempt.until.trim().length === 0
        );
      })
      .map(([model]) => model);
    expect(
      malformed,
      `${malformed.join(", ")} is/are 'exempt' with a blank ground or expiry - ` +
        "D-154 requires the ground to be stated, not implied.",
    ).toEqual([]);
  });

  it("AuditEvent is an ENUMERATED exemption, not an absence (D-154's own example)", () => {
    expect(ERASURE_REGISTRY.AuditEvent).toBeDefined();
    expect(ERASURE_REGISTRY.AuditEvent.kind).toBe("exempt");
  });
});
