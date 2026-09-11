/**
 * D-188's JSON surface — `catalogue-json-service.ts` — against a real
 * Postgres. On the `skills-services.test.ts` pattern.
 *
 * WHAT THIS FILE PINS:
 *   - round-tripping: export, wipe the catalogue (never the seeded grade
 *     scale — D-160/D-164, see the file comment on `catalogue-json-
 *     service.ts`), re-import, and the result is the SAME catalogue by
 *     content (never by id/timestamp, which differ by construction);
 *   - all-or-nothing: a document broken partway through leaves NOTHING
 *     written, verified by querying the database after the refusal;
 *   - the same guard the form uses (`skills.manage_catalogue`/`skills.read`);
 *   - reconciling an existing DRAFT (add + correct a criterion) versus
 *     refusing to silently rewrite an already-published version (D-081).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  CatalogueImportError,
  exportCatalogue,
  importCatalogue,
  publishCriterionSet,
  type CatalogueDocument,
} from "@/modules/skills";

import {
  SKILLS_ADMIN_PERMISSIONS,
  grantTo,
  installRealRelations,
  makeAwardType,
  makeCriterion,
  makeCriterionSet,
  makeFiveGradeScale,
  makePerson,
  makeRole,
  resetSkillsFixtures,
  sid,
} from "../support/skills-fixtures";

const NOW = new Date("2026-06-01T12:00:00.000Z");

let adminId: string;
let noPermId: string;
let scale: { scaleId: string; gradeIds: Record<string, string> };
let scaleCode: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

function noPerm() {
  return { principal: { personId: noPermId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetSkillsFixtures();
  adminId = await makePerson("json_admin");
  noPermId = await makePerson("json_noperm");
  const adminRoleId = await makeRole(
    "json_role_admin",
    SKILLS_ADMIN_PERMISSIONS,
  );
  await grantTo({
    personId: adminId,
    roleId: adminRoleId,
    scopeType: "ORGANIZATION",
  });

  // The seeded scale a real installation always has (D-160) — created once
  // per test, never wiped by `resetSkillsFixtures` (it only clears rows whose
  // id/code starts with the fixture prefix on the CATALOGUE tables), exactly
  // as a real grade scale survives a catalogue re-import.
  scale = await makeFiveGradeScale("json");
  const scaleRow = await prisma.gradeScale.findUniqueOrThrow({
    where: { id: scale.scaleId },
    select: { code: true },
  });
  scaleCode = scaleRow.code;
});

afterAll(async () => {
  await resetSkillsFixtures();
});

async function countCatalogueRowsFor(code: string): Promise<{
  awardTypes: number;
  criterionSets: number;
  criteria: number;
}> {
  const awardTypes = await prisma.awardType.count({ where: { code } });
  const criterionSets = await prisma.criterionSet.count({
    where: { awardType: { code } },
  });
  const criteria = await prisma.criterion.count({
    where: { criterionSet: { awardType: { code } } },
  });
  return { awardTypes, criterionSets, criteria };
}

describe("exportCatalogue / importCatalogue — guard", () => {
  it("refuses export without skills.read", async () => {
    await expect(exportCatalogue(noPerm())).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("refuses import without skills.manage_catalogue", async () => {
    await expect(
      importCatalogue(noPerm(), { catalogueVersion: 1, awardTypes: [] }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("exportCatalogue", () => {
  it("serialises an award type's published catalogue with grade codes, not ids", async () => {
    const code = sid("code_export1");
    const awardTypeId = await prisma.awardType.create({
      data: {
        id: sid("export1"),
        code,
        name: "Export Diploma",
        kind: "DIPLOMA",
        issuingBody: "NRZ",
      },
      select: { id: true },
    });
    const setId = await makeCriterionSet(awardTypeId.id, "export1", {
      version: 1,
      source: "NRZ",
      status: "ACTIVE",
      passFloorGradeId: scale.gradeIds.voldoende,
      effectiveFrom: NOW,
    });
    await makeCriterion(setId, "export1_a", {
      sequence: 1,
      minimumGradeId: scale.gradeIds.goed,
    });

    const document = await exportCatalogue(admin(), {
      awardTypeIds: [awardTypeId.id],
    });

    expect(document.catalogueVersion).toBe(1);
    const awardType = document.awardTypes.find((a) => a.code === code);
    expect(awardType).toBeDefined();
    const set = awardType!.criterionSets[0]!;
    expect(set.status).toBe("ACTIVE");
    expect(set.passFloor).toEqual({
      gradeScale: scaleCode,
      grade: "JSON_VOLDOENDE",
    });
    expect(set.criteria[0]!.minimumGrade).toEqual({
      gradeScale: scaleCode,
      grade: "JSON_GOED",
    });
  });
});

describe("importCatalogue — round trip", () => {
  it("reproduces the same catalogue content after export, wipe, re-import", async () => {
    const code = sid("code_rt1");
    const awardTypeId = (
      await prisma.awardType.create({
        data: {
          id: sid("rt1"),
          code,
          name: "Round-trip Diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
        },
        select: { id: true },
      })
    ).id;
    const v1 = await makeCriterionSet(awardTypeId, "rt1_v1", {
      version: 1,
      source: "ORG",
      status: "RETIRED",
      passFloorGradeId: scale.gradeIds.voldoende,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-02-01T00:00:00Z"),
    });
    await makeCriterion(v1, "rt1_v1_a", { sequence: 1 });
    const v2 = await makeCriterionSet(awardTypeId, "rt1_v2", {
      version: 2,
      source: "ORG",
      status: "ACTIVE",
      passFloorGradeId: scale.gradeIds.goed,
      effectiveFrom: new Date("2026-02-01T00:00:00Z"),
    });
    await makeCriterion(v2, "rt1_v2_a", { sequence: 1 });
    await makeCriterion(v2, "rt1_v2_b", {
      sequence: 2,
      minimumGradeId: scale.gradeIds.zeergoed,
    });

    const exported = await exportCatalogue(admin(), {
      awardTypeIds: [awardTypeId],
    });

    // Wipe the catalogue only — never the grade scale (D-160: seeded,
    // persists across a catalogue re-import in a real installation).
    await prisma.criterion.deleteMany({
      where: { criterionSet: { awardTypeId } },
    });
    await prisma.criterionSet.deleteMany({ where: { awardTypeId } });
    await prisma.awardType.delete({ where: { id: awardTypeId } });
    expect(await countCatalogueRowsFor(code)).toEqual({
      awardTypes: 0,
      criterionSets: 0,
      criteria: 0,
    });

    await importCatalogue(admin(), exported as unknown);

    const reimported = await exportCatalogue(admin(), {});
    const awardType = reimported.awardTypes.find((a) => a.code === code);
    expect(awardType).toBeDefined();

    // Compare CONTENT only — never ids, never effectiveFrom/effectiveTo
    // (stamped from the clock at publish time, D-188's round-trip
    // requirement is about content, not timestamps that differ by
    // construction).
    const strip = (doc: CatalogueDocument) =>
      doc.awardTypes
        .filter((a) => a.code === code)
        .map((a) => ({
          code: a.code,
          name: a.name,
          kind: a.kind,
          issuingBody: a.issuingBody,
          criterionSets: a.criterionSets.map((s) => ({
            version: s.version,
            source: s.source,
            status: s.status,
            passFloor: s.passFloor,
            criteria: s.criteria.map((c) => ({
              code: c.code,
              name: c.name,
              standard: c.standard,
              sequence: c.sequence,
              minimumGrade: c.minimumGrade,
            })),
          })),
        }));

    expect(strip(reimported)).toEqual(strip(exported));
  });
});

describe("importCatalogue — all or nothing", () => {
  it("rolls back every write when a later award type in the document is refused", async () => {
    const goodCode = sid("code_aon_good");
    const badCode = sid("code_aon_bad");

    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code: goodCode,
          name: "Goed diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "DRAFT",
              passFloor: null,
              criteria: [
                {
                  code: "G1",
                  name: "Eis 1",
                  standard: null,
                  sequence: 1,
                  minimumGrade: null,
                },
              ],
            },
          ],
        },
        {
          code: badCode,
          name: "Fout diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "DRAFT",
              passFloor: null,
              criteria: [
                {
                  code: "B1",
                  name: "Eis 1",
                  standard: null,
                  sequence: 1,
                  minimumGrade: null,
                },
                {
                  // Third criterion, deliberately invalid: an empty name is
                  // refused by `createCriterion`'s own `requiredText`.
                  code: "B2",
                  name: "   ",
                  standard: null,
                  sequence: 2,
                  minimumGrade: null,
                },
              ],
            },
          ],
        },
      ],
    };

    await expect(importCatalogue(admin(), document)).rejects.toBeInstanceOf(
      CatalogueImportError,
    );

    expect(await countCatalogueRowsFor(goodCode)).toEqual({
      awardTypes: 0,
      criterionSets: 0,
      criteria: 0,
    });
    expect(await countCatalogueRowsFor(badCode)).toEqual({
      awardTypes: 0,
      criterionSets: 0,
      criteria: 0,
    });
  });

  it("names the exact award type, criterion set and criterion responsible", async () => {
    const code = sid("code_aon_path");
    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code,
          name: "Diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "DRAFT",
              passFloor: null,
              criteria: [
                {
                  code: "X1",
                  name: "Eis 1",
                  standard: null,
                  sequence: 1,
                  minimumGrade: { gradeScale: "does-not-exist", grade: "X" },
                },
              ],
            },
          ],
        },
      ],
    };

    let caught: unknown;
    try {
      await importCatalogue(admin(), document);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CatalogueImportError);
    const path = (caught as InstanceType<typeof CatalogueImportError>).path;
    expect(path).toContain("awardTypes[0]");
    expect(path).toContain("criterionSets[0]");
    expect(path).toContain("criteria[0]");
    expect(path).toContain("minimumGrade");

    expect(await countCatalogueRowsFor(code)).toEqual({
      awardTypes: 0,
      criterionSets: 0,
      criteria: 0,
    });
  });

  it("rejects a document whose next version does not match the next free version", async () => {
    const code = sid("code_aon_version");
    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code,
          name: "Diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              // Skips version 1 — createCriterionSet always allocates 1 for
              // a brand-new award type, so this must be refused outright.
              version: 2,
              source: "ORG",
              status: "DRAFT",
              passFloor: null,
              criteria: [],
            },
          ],
        },
      ],
    };

    await expect(importCatalogue(admin(), document)).rejects.toThrow(
      /eerstvolgende vrije versie/,
    );
    expect(await countCatalogueRowsFor(code)).toEqual({
      awardTypes: 0,
      criterionSets: 0,
      criteria: 0,
    });
  });
});

describe("importCatalogue — create and reconcile", () => {
  it("creates a brand-new award type with a published set", async () => {
    const code = sid("code_new1");
    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code,
          name: "Nieuw diploma",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "ACTIVE",
              passFloor: { gradeScale: scaleCode, grade: "JSON_VOLDOENDE" },
              criteria: [
                {
                  code: "N1",
                  name: "Eerste eis",
                  standard: "Wat er verwacht wordt.",
                  sequence: 1,
                  minimumGrade: null,
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await importCatalogue(admin(), document);
    expect(result).toEqual({
      awardTypesProcessed: 1,
      criterionSetsProcessed: 1,
      criteriaProcessed: 1,
    });

    const row = await prisma.awardType.findUniqueOrThrow({
      where: { code },
      select: {
        criterionSets: {
          select: { status: true, passFloorGradeId: true, criteria: true },
        },
      },
    });
    expect(row.criterionSets[0]?.status).toBe("ACTIVE");
    expect(row.criterionSets[0]?.passFloorGradeId).toBe(
      scale.gradeIds.voldoende,
    );
    expect(row.criterionSets[0]?.criteria).toHaveLength(1);
  });

  it("adds a new criterion to, and corrects an existing one in, an open DRAFT", async () => {
    const awardTypeId = await makeAwardType("recon1", { kind: "DIPLOMA" });
    const awardTypeRow = await prisma.awardType.findUniqueOrThrow({
      where: { id: awardTypeId },
      select: { code: true },
    });
    const setId = await makeCriterionSet(awardTypeId, "recon1", {
      version: 1,
      source: "ORG",
      status: "DRAFT",
    });
    await makeCriterion(setId, "recon1_a", { sequence: 1 });

    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code: awardTypeRow.code,
          name: "Diploma recon1",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "DRAFT",
              passFloor: null,
              criteria: [
                {
                  // Existing criterion, corrected: a new name.
                  code: "RECON1_A",
                  name: "Aangepaste naam",
                  standard: null,
                  sequence: 1,
                  minimumGrade: null,
                },
                {
                  // Brand-new criterion in the same set.
                  code: "RECON1_B",
                  name: "Tweede eis",
                  standard: null,
                  sequence: 2,
                  minimumGrade: null,
                },
              ],
            },
          ],
        },
      ],
    };

    await importCatalogue(admin(), document);

    const criteria = await prisma.criterion.findMany({
      where: { criterionSetId: setId },
      orderBy: { sequence: "asc" },
    });
    expect(criteria).toHaveLength(2);
    expect(criteria[0]?.name).toBe("Aangepaste naam");
    expect(criteria[1]?.code).toBe("RECON1_B");
  });

  it("refuses a document that disagrees with an already-published version (D-081)", async () => {
    const awardTypeId = await makeAwardType("published1", { kind: "DIPLOMA" });
    const awardTypeRow = await prisma.awardType.findUniqueOrThrow({
      where: { id: awardTypeId },
      select: { code: true },
    });
    const setId = await makeCriterionSet(awardTypeId, "published1", {
      version: 1,
      source: "ORG",
      status: "DRAFT",
      passFloorGradeId: scale.gradeIds.voldoende,
    });
    await makeCriterion(setId, "pub1_a", { sequence: 1 });
    await publishCriterionSet(admin(), setId);

    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code: awardTypeRow.code,
          name: "Diploma published1",
          kind: "DIPLOMA",
          issuingBody: "ORG",
          criterionSets: [
            {
              version: 1,
              source: "ORG",
              status: "ACTIVE",
              passFloor: { gradeScale: scaleCode, grade: "JSON_VOLDOENDE" },
              criteria: [
                {
                  // Disagrees with history: the name was never "Gewijzigd".
                  code: "PUB1_A",
                  name: "Gewijzigd",
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

    await expect(importCatalogue(admin(), document)).rejects.toThrow(/D-081/);

    const unchanged = await prisma.criterion.findFirst({
      where: { criterionSetId: setId },
    });
    expect(unchanged?.name).toBe("Eis pub1_a");
  });

  it("re-affirms an already-published version silently when the document agrees exactly", async () => {
    const awardTypeId = await makeAwardType("agree1", { kind: "DIPLOMA" });
    const awardTypeRow = await prisma.awardType.findUniqueOrThrow({
      where: { id: awardTypeId },
      select: { code: true },
    });
    const setId = await makeCriterionSet(awardTypeId, "agree1", {
      version: 1,
      source: "ORG",
      status: "DRAFT",
      passFloorGradeId: scale.gradeIds.voldoende,
    });
    await makeCriterion(setId, "agree1_a", { sequence: 1 });
    await publishCriterionSet(admin(), setId);

    const exported = await exportCatalogue(admin(), {
      awardTypeIds: [awardTypeId],
    });

    await expect(
      importCatalogue(admin(), exported as unknown),
    ).resolves.toEqual({
      awardTypesProcessed: 1,
      criterionSetsProcessed: 1,
      criteriaProcessed: 0,
    });
    void awardTypeRow;
  });

  it("refuses a document that tries to change an existing award type's kind", async () => {
    const awardTypeId = await makeAwardType("kind1", { kind: "DIPLOMA" });
    const awardTypeRow = await prisma.awardType.findUniqueOrThrow({
      where: { id: awardTypeId },
      select: { code: true, name: true },
    });

    const document = {
      catalogueVersion: 1,
      awardTypes: [
        {
          code: awardTypeRow.code,
          name: awardTypeRow.name,
          kind: "CERTIFICATE",
          issuingBody: "ORG",
          criterionSets: [],
        },
      ],
    };

    await expect(importCatalogue(admin(), document)).rejects.toThrow(/kind/);
  });
});
