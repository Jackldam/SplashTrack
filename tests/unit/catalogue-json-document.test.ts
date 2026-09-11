/**
 * Structural parsing only — `parseCatalogueDocument`'s own contract: is this
 * JSON shaped like a catalogue document, with a `CatalogueImportError` naming
 * exactly which part is wrong. No database, no business rules (those are
 * `tests/integration/skills-catalogue-json.test.ts`'s job).
 */
import { describe, expect, it } from "vitest";

import { CatalogueImportError, parseCatalogueDocument } from "@/modules/skills";

const MINIMAL_VALID = {
  catalogueVersion: 1,
  awardTypes: [
    {
      code: "A",
      name: "Diploma A",
      kind: "DIPLOMA",
      issuingBody: "NRZ",
      criterionSets: [
        {
          version: 1,
          source: "NRZ",
          status: "DRAFT",
          passFloor: null,
          criteria: [
            {
              code: "A1",
              name: "Eis 1",
              standard: null,
              sequence: 1,
              minimumGrade: null,
            },
          ],
        },
      ],
    },
  ],
};

describe("parseCatalogueDocument", () => {
  it("accepts a minimal, well-shaped document", () => {
    const parsed = parseCatalogueDocument(MINIMAL_VALID);
    expect(parsed.awardTypes).toHaveLength(1);
    expect(parsed.awardTypes[0]?.criterionSets[0]?.criteria[0]?.code).toBe(
      "A1",
    );
  });

  it("rejects a non-object document", () => {
    expect(() => parseCatalogueDocument("not an object")).toThrow(
      CatalogueImportError,
    );
    expect(() => parseCatalogueDocument(null)).toThrow(CatalogueImportError);
    expect(() => parseCatalogueDocument([1, 2, 3])).toThrow(
      CatalogueImportError,
    );
  });

  it("rejects an unsupported catalogueVersion", () => {
    expect(() =>
      parseCatalogueDocument({ ...MINIMAL_VALID, catalogueVersion: 2 }),
    ).toThrow(/catalogueVersion/);
  });

  it("rejects a missing awardTypes list", () => {
    const rest = { catalogueVersion: MINIMAL_VALID.catalogueVersion };
    expect(() => parseCatalogueDocument(rest)).toThrow(/awardTypes/);
  });

  it("names the exact award type and field for a missing name", () => {
    const broken = {
      catalogueVersion: 1,
      awardTypes: [
        { code: "A", kind: "DIPLOMA", issuingBody: "NRZ", criterionSets: [] },
      ],
    };
    try {
      parseCatalogueDocument(broken);
      expect.fail("expected a CatalogueImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogueImportError);
      expect((error as InstanceType<typeof CatalogueImportError>).path).toBe(
        "awardTypes[0] (A).name",
      );
    }
  });

  it("names the exact criterion for a malformed sequence", () => {
    const broken = structuredClone(MINIMAL_VALID);
    // @ts-expect-error -- deliberately malformed for the test
    broken.awardTypes[0].criterionSets[0].criteria[0].sequence = "one";
    try {
      parseCatalogueDocument(broken);
      expect.fail("expected a CatalogueImportError");
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogueImportError);
      expect((error as InstanceType<typeof CatalogueImportError>).path).toBe(
        "awardTypes[0] (A).criterionSets[0].criteria[0].sequence",
      );
    }
  });

  it("rejects a grade reference missing its scale code", () => {
    const broken = structuredClone(MINIMAL_VALID);
    broken.awardTypes[0].criterionSets[0].criteria[0].minimumGrade = {
      grade: "GOED",
    } as never;
    expect(() => parseCatalogueDocument(broken)).toThrow(/gradeScale/);
  });
});
