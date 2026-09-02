import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PERSON_REFERENCE_CLASSIFICATION } from "@/modules/users/infrastructure/person-reference-classification";

import { extractModelBlocks } from "./prisma-schema-parser";

/**
 * Guards the same risk `tests/unit/organization-scope-sync.test.ts` guards for
 * `organizationId`, applied to `Person`: `PERSON_REFERENCE_CLASSIFICATION`
 * (src/modules/users/infrastructure/person-reference-classification.ts) is a
 * hand-maintained map that must account for every field in
 * `prisma/schema.prisma` referencing a `Person` — a `personId`/`*PersonId`
 * scalar column, or a relation typed `Person`/`Person?` — or GDPR Art. 17
 * erasure coverage for that column is a silent, undocumented accident.
 *
 * This is exactly the gap that produced two real bugs: `OrganizationBranding
 * .updatedByPersonId` had a `Restrict` FK with no sever step (an erasure of
 * that editor rolled back the WHOLE transaction), and
 * `MaintenanceJob.updatedByPersonId` was never referenced by
 * `person-erasure-repository.ts` at all (no FK, so erasure "succeeded" but
 * silently left the erased person's id on the row forever). Neither table
 * would have failed a Prisma migration or a typecheck — only a schema-vs-map
 * sync test like this one catches it, and only if this test is the one
 * accurate mirror of the schema.
 *
 * Parses prisma/schema.prisma directly (not the generated client) so it fails
 * the moment schema and map drift apart, in EITHER direction. Model-body
 * extraction is shared with `organization-scope-sync.test.ts` via
 * `./prisma-schema-parser` — see that file for why a brace-DEPTH walk is used
 * instead of a naive first-`}` regex, and `prisma-schema-parser.test.ts` for
 * the regression guard.
 */

/**
 * Within one model's body, finds every field referencing `Person`:
 *   - a scalar column whose name ends in `personId` (case-insensitive) —
 *     covers `personId` itself and every `*PersonId` (createdByPersonId,
 *     updatedByPersonId, actorPersonId, uploadedByPersonId, ...), including
 *     the several PLAIN-TOKEN ones that carry NO relation/FK by design
 *     (AuditEvent, CustomPage, EmailTemplate, ApiCredential, MaintenanceJob,
 *     PlatformBootstrap);
 *   - a relation field typed `Person` or `Person?` (never `Person[]`, which
 *     is a Person-side BACK-relation, not a Person-referencing column) —
 *     covers every FK-backed pointer, reading the scalar column name out of
 *     its `@relation(fields: [...])` attribute so a hypothetically
 *     unconventionally-named FK column (not ending in `PersonId`) is still
 *     caught.
 * Returns the UNION as scalar column names.
 */
function personReferenceFields(body: string): Set<string> {
  const fields = new Set<string>();

  const scalarPattern = /^\s*(\w+)\s+String\b/gm;
  let scalarMatch: RegExpExecArray | null;
  while ((scalarMatch = scalarPattern.exec(body)) !== null) {
    if (/personid$/i.test(scalarMatch[1])) {
      fields.add(scalarMatch[1]);
    }
  }

  const relationPattern = /^\s*(\w+)\s+Person\??\s+@relation\(([^)]*)\)/gm;
  let relationMatch: RegExpExecArray | null;
  while ((relationMatch = relationPattern.exec(body)) !== null) {
    const fieldsMatch = /fields:\s*\[(\w+)\]/.exec(relationMatch[2]);
    if (fieldsMatch) {
      fields.add(fieldsMatch[1]);
    }
  }

  return fields;
}

describe("PERSON_REFERENCE_CLASSIFICATION stays in sync with prisma/schema.prisma", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf-8",
  );
  const modelBlocks = extractModelBlocks(schema);

  const schemaPersonRefs = new Set<string>();
  for (const [model, body] of modelBlocks) {
    for (const field of personReferenceFields(body)) {
      schemaPersonRefs.add(`${model}.${field}`);
    }
  }

  it("found at least one model (sanity check the schema actually parsed)", () => {
    expect(modelBlocks.size).toBeGreaterThan(10);
  });

  it("found the known Person-referencing columns (sanity check the parser itself)", () => {
    // A fixed floor of columns known (by manual audit) to reference Person
    // today. If this shrinks, the PARSER broke (e.g. reverted to the naive
    // brace pattern) — that is a bug in the test, not a schema change, and
    // must be investigated before touching the other two assertions below.
    for (const known of [
      "UserAccount.personId",
      "PlatformSettings.updatedByPersonId",
      "CustomPage.createdByPersonId",
      "CustomPage.updatedByPersonId",
      "EmailTemplate.updatedByPersonId",
      "MaintenanceJob.updatedByPersonId",
      "AuditEvent.actorPersonId",
      "PlatformBootstrap.personId",
    ]) {
      expect(schemaPersonRefs.has(known), known).toBe(true);
    }
  });

  it("accounts for every schema field referencing Person in PERSON_REFERENCE_CLASSIFICATION", () => {
    const missing = [...schemaPersonRefs].filter(
      (ref) => !(ref in PERSON_REFERENCE_CLASSIFICATION),
    );
    expect(
      missing,
      `${missing.join(", ")} reference(s) Person in prisma/schema.prisma but ` +
        "are not classified in PERSON_REFERENCE_CLASSIFICATION " +
        "(src/modules/users/infrastructure/person-reference-classification.ts) - " +
        "GDPR Art. 17 erasure coverage for this column is undocumented and " +
        "possibly missing. Add an entry with an explicit category and reason.",
    ).toEqual([]);
  });

  it("lists no classification entry for a field that no longer references Person", () => {
    const stale = Object.keys(PERSON_REFERENCE_CLASSIFICATION).filter(
      (ref) => !schemaPersonRefs.has(ref),
    );
    expect(
      stale,
      `${stale.join(", ")} is/are listed in PERSON_REFERENCE_CLASSIFICATION ` +
        "but no longer reference Person in prisma/schema.prisma - remove the " +
        "stale entry.",
    ).toEqual([]);
  });

  it("requires a written reason for every RETAIN_BY_DESIGN entry", () => {
    const unreasoned = Object.entries(PERSON_REFERENCE_CLASSIFICATION)
      .filter(
        ([, classification]) =>
          classification.category === "RETAIN_BY_DESIGN" &&
          classification.reason.trim().length === 0,
      )
      .map(([ref]) => ref);
    expect(
      unreasoned,
      `${unreasoned.join(", ")} is/are classified RETAIN_BY_DESIGN with no ` +
        "reason - this is the category easiest to hide a silent data leak " +
        "behind, so it must be justified in writing.",
    ).toEqual([]);
  });
});
