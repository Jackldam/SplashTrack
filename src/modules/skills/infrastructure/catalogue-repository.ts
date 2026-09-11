/**
 * Reads over `AwardType`, `GradeScale`/`GradeValue`, `CriterionSet` and
 * `Criterion` — the empty-by-default catalogue D-164 ships and an
 * administrator authors.
 *
 * UNGUARDED. Every function here is reached only after the service has
 * guarded `skills.read` / `skills.manage_catalogue` at `{ organization: true }`
 * — the ONLY scope that ever covers these rows, because the catalogue has no
 * narrower `ResourceRef` kind of its own (`@/lib/authorization/scope.ts` names
 * `organization | unit | group | course | session | student | person`, and
 * none of them is "award type" or "criterion set"). So there is no
 * `xFilterForReach` in this module: unlike `Course` or `ScheduledSession`,
 * which several scope types can cover in different ways, the catalogue is
 * either fully visible (an `ORGANIZATION` grant) or not visible at all — the
 * same reasoning `createCourse`'s `{ organization: true }` reference already
 * rests on, generalised to every read and write in this file.
 *
 * SERVER-ONLY.
 */
import { prisma, type DatabaseClient } from "@/lib/database";

import { inSequence } from "../domain/criterion";

export interface GradeValueView {
  readonly id: string;
  readonly code: string;
  readonly rank: number;
  readonly label: string;
}

export interface GradeScaleView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly values: readonly GradeValueView[];
}

/** The seeded scale(s), values in rank order. Read-only in this phase's UI. */
export async function listGradeScales(): Promise<GradeScaleView[]> {
  const rows = await prisma.gradeScale.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      values: { select: { id: true, code: true, rank: true, label: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    values: [...row.values].sort((left, right) => left.rank - right.rank),
  }));
}

export interface AwardTypeListItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly issuingBody: string;
  readonly criterionSetCount: number;
  /** Whether an ACTIVE `CriterionSet` exists — assessable right now, or not. */
  readonly hasActiveCriterionSet: boolean;
}

export async function listAwardTypes(): Promise<AwardTypeListItem[]> {
  const rows = await prisma.awardType.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      issuingBody: true,
      _count: { select: { criterionSets: true } },
      criterionSets: {
        where: { status: "ACTIVE" },
        select: { id: true },
        take: 1,
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    issuingBody: row.issuingBody,
    criterionSetCount: row._count.criterionSets,
    hasActiveCriterionSet: row.criterionSets.length > 0,
  }));
}

export interface CriterionSetSummary {
  readonly id: string;
  readonly version: number;
  readonly source: string;
  readonly status: string;
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly criterionCount: number;
}

export interface AwardTypeDetail extends AwardTypeListItem {
  readonly criterionSets: readonly CriterionSetSummary[];
}

export async function findAwardTypeDetail(
  awardTypeId: string,
): Promise<AwardTypeDetail | null> {
  const row = await prisma.awardType.findUnique({
    where: { id: awardTypeId },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      issuingBody: true,
      criterionSets: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          source: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
          _count: { select: { criteria: true } },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    issuingBody: row.issuingBody,
    criterionSetCount: row.criterionSets.length,
    hasActiveCriterionSet: row.criterionSets.some(
      (set) => set.status === "ACTIVE",
    ),
    criterionSets: row.criterionSets.map((set) => ({
      id: set.id,
      version: set.version,
      source: set.source,
      status: set.status,
      effectiveFrom: set.effectiveFrom,
      effectiveTo: set.effectiveTo,
      criterionCount: set._count.criteria,
    })),
  };
}

export interface CriterionView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly standard: string | null;
  readonly sequence: number;
  readonly minimumGradeId: string | null;
}

export interface CriterionSetDetail {
  readonly id: string;
  readonly awardTypeId: string;
  readonly awardTypeName: string;
  readonly version: number;
  readonly source: string;
  readonly status: string;
  readonly effectiveFrom: Date | null;
  readonly effectiveTo: Date | null;
  readonly passFloorGradeId: string | null;
  readonly criteria: readonly CriterionView[];
}

export async function findCriterionSetDetail(
  criterionSetId: string,
  client: DatabaseClient = prisma,
): Promise<CriterionSetDetail | null> {
  const row = await client.criterionSet.findUnique({
    where: { id: criterionSetId },
    select: {
      id: true,
      awardTypeId: true,
      awardType: { select: { name: true } },
      version: true,
      source: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      passFloorGradeId: true,
      criteria: {
        select: {
          id: true,
          code: true,
          name: true,
          standard: true,
          sequence: true,
          minimumGradeId: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    awardTypeId: row.awardTypeId,
    awardTypeName: row.awardType.name,
    version: row.version,
    source: row.source,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    passFloorGradeId: row.passFloorGradeId,
    criteria: inSequence(row.criteria),
  };
}

/**
 * Every version of one `AwardType`'s criterion sets, for version allocation.
 * Takes `client` (the `person-repository.ts` pattern) so a caller composing
 * this into a bigger transaction — `createCriterionSet` itself, and the JSON
 * importer, `catalogue-json-service.ts` — sees its own not-yet-committed
 * writes rather than a stale read from the module-level `prisma`.
 */
export async function listCriterionSetVersions(
  awardTypeId: string,
  client: DatabaseClient = prisma,
): Promise<{ version: number }[]> {
  return client.criterionSet.findMany({
    where: { awardTypeId },
    select: { version: true },
  });
}

/**
 * The open `DRAFT`, if one exists — `createCriterionSet` refuses a second.
 * Takes `client` for the same read-your-own-writes reason as
 * {@link listCriterionSetVersions}.
 */
export async function findOpenDraft(
  awardTypeId: string,
  client: DatabaseClient = prisma,
): Promise<{ id: string } | null> {
  return client.criterionSet.findFirst({
    where: { awardTypeId, status: "DRAFT" },
    select: { id: true },
  });
}

/** One `AwardType` by its stable, administrator-facing code, or null. */
export async function findAwardTypeByCode(
  code: string,
  client: DatabaseClient = prisma,
): Promise<{ id: string; kind: string } | null> {
  return client.awardType.findUnique({
    where: { code },
    select: { id: true, kind: true },
  });
}

/** One `CriterionSet` by its `(awardTypeId, version)` pair, or null. */
export async function findCriterionSetByVersion(
  awardTypeId: string,
  version: number,
  client: DatabaseClient = prisma,
): Promise<{ id: string; status: string } | null> {
  return client.criterionSet.findUnique({
    where: { awardTypeId_version: { awardTypeId, version } },
    select: { id: true, status: true },
  });
}

/** One `Criterion` by its `(criterionSetId, code)` pair, or null. */
export async function findCriterionByCode(
  criterionSetId: string,
  code: string,
  client: DatabaseClient = prisma,
): Promise<{ id: string } | null> {
  return client.criterion.findUnique({
    where: { criterionSetId_code: { criterionSetId, code } },
    select: { id: true },
  });
}

/**
 * One `GradeValue` by its scale's code and its own code — the portable key
 * the catalogue JSON document uses instead of an internal id. See
 * `catalogue-json-service.ts`'s file comment for why.
 */
export async function findGradeValueByCodes(
  scaleCode: string,
  valueCode: string,
  client: DatabaseClient = prisma,
): Promise<{ id: string } | null> {
  const scale = await client.gradeScale.findUnique({
    where: { code: scaleCode },
    select: { id: true },
  });
  if (!scale) return null;
  return client.gradeValue.findUnique({
    where: { scaleId_code: { scaleId: scale.id, code: valueCode } },
    select: { id: true },
  });
}

/** A `GradeValue`'s own code and its scale's code, by id — export's mirror. */
export async function gradeValueCodesById(
  gradeValueId: string,
  client: DatabaseClient = prisma,
): Promise<{ scaleCode: string; valueCode: string } | null> {
  const row = await client.gradeValue.findUnique({
    where: { id: gradeValueId },
    select: { code: true, scale: { select: { code: true } } },
  });
  if (!row) return null;
  return { scaleCode: row.scale.code, valueCode: row.code };
}

/** The current `ACTIVE` set of an `AwardType`, if one exists. */
export async function findActiveCriterionSet(
  awardTypeId: string,
): Promise<{ id: string } | null> {
  return prisma.criterionSet.findFirst({
    where: { awardTypeId, status: "ACTIVE" },
    select: { id: true },
  });
}

/** Which `CriterionSet` a criterion belongs to, and that set's status. */
export async function criterionSetOfCriterion(
  criterionId: string,
  client: DatabaseClient = prisma,
): Promise<{
  criterionSetId: string;
  status: string;
} | null> {
  const row = await client.criterion.findUnique({
    where: { id: criterionId },
    select: {
      criterionSetId: true,
      criterionSet: { select: { status: true } },
    },
  });
  if (!row) return null;
  return {
    criterionSetId: row.criterionSetId,
    status: row.criterionSet.status,
  };
}

/**
 * The rank of every requested `GradeValue`, by id — the published answer
 * `assessment` (phase 2.3) builds D-080's pass computation from. `rank` is
 * D-080's own comparison (`GradeValue.rank`'s own model comment: "`rank` IS
 * THE COMPARISON"); an id with no matching row is simply absent from the
 * returned map, on the same "positive membership only" discipline the
 * authorization layer uses, so a caller handed a stale or foreign id fails
 * closed rather than silently comparing against `undefined`.
 *
 * UNGUARDED, on the {@link criterionSetOfCriterion}/`listActiveCriteria`
 * precedent: ids and ranks, nothing about anybody, and the caller has
 * already guarded its own write or read before it asks.
 */
export async function gradeValuesByIds(
  gradeValueIds: readonly string[],
): Promise<Map<string, number>> {
  if (gradeValueIds.length === 0) return new Map();
  const rows = await prisma.gradeValue.findMany({
    where: { id: { in: [...gradeValueIds] } },
    select: { id: true, rank: true },
  });
  return new Map(rows.map((row) => [row.id, row.rank]));
}

/**
 * The ACTIVE criterion set's criteria for one `AwardType`, in order — what
 * `listCriteriaForGroup` renders as the picker. Empty when there is no
 * `ACTIVE` set yet (a `DRAFT` still being composed is never assessable,
 * D-081).
 */
export async function listActiveCriteria(
  awardTypeId: string,
): Promise<CriterionView[]> {
  const set = await prisma.criterionSet.findFirst({
    where: { awardTypeId, status: "ACTIVE" },
    select: {
      criteria: {
        select: {
          id: true,
          code: true,
          name: true,
          standard: true,
          sequence: true,
          minimumGradeId: true,
        },
      },
    },
  });
  if (!set) return [];
  return inSequence(set.criteria);
}
