/**
 * D-188's second surface: the assessment catalogue as one JSON document.
 *
 * "THE JSON IS NOT A SEPARATE IMPORTER WITH ITS OWN RULES" — D-188, verbatim.
 * `importCatalogue` below does not re-implement any of `award-type-service.ts`,
 * `criterion-set-service.ts` or `criterion-service.ts`'s validation, sequencing
 * or audit trail. It calls exactly those functions, passing them the SAME
 * transaction client (the `DatabaseClient` parameter each of those three files
 * gained for this feature) so a whole document either commits together or
 * nothing does. What this file adds on top is purely structural: walking the
 * document in order, matching each entry against what already exists (by
 * `AwardType.code`, `CriterionSet.version`, `Criterion.code` — see below for
 * why), and turning a service's refusal into an error that names WHERE in the
 * document it happened, because "validation failed" on a document with forty
 * criteria is not an answer an administrator can act on.
 *
 * WHY A CODE/VERSION KEY, NEVER AN INTERNAL id
 *
 * `AwardType.id`, `CriterionSet.id`, `Criterion.id` are `cuid()`s — opaque,
 * install-specific, and never typed by a person. Round-tripping (D-188: "a
 * requirement, not a nicety") means export, then re-import — possibly on a
 * DIFFERENT installation entirely, which is D-188's own stated first use case
 * ("the initial load"). A document keyed by id would be meaningless the
 * moment it crossed an installation boundary. So the document identifies an
 * `AwardType` by its own stable `code`, a `CriterionSet` by
 * `(awardTypeId, version)` — already the schema's own unique key — and a
 * `Criterion` by `(criterionSetId, code)` — likewise already unique. A
 * `GradeValue` reference (a criterion's `minimumGrade`, a set's `passFloor`)
 * is written as `{ gradeScale, grade }` — the seeded scale's own code and the
 * value's own code (D-160: "the one grade scale IS seeded" — the same two
 * codes exist on every installation) — never `GradeValue.id`.
 *
 * WHAT "UPDATE IN BULK" MEANS GIVEN D-081's VERSIONING
 *
 * `AwardType.code` and `.kind` are immutable once created (see
 * `updateAwardType`'s own comment) — a document that disagrees with an
 * existing installation about either is refused, not silently reconciled.
 * A `CriterionSet` at a version this installation does not yet have is a new
 * `DRAFT`, its criteria created and its pass floor and status (`DRAFT` or
 * `ACTIVE`) applied through the ordinary services — this is the only path
 * `publishCriterionSet` is ever reached from here. A `CriterionSet` at a
 * version that already exists and is still `DRAFT` is reconciled criterion by
 * criterion (created if missing, updated if present, matched by `code`) — the
 * "correct before publishing" case D-081 already allows through the form. A
 * version that already exists and is `ACTIVE`/`RETIRED` is D-081's "never
 * edited" case: the import verifies the document agrees with what is already
 * there and otherwise refuses outright, rather than silently accepting a
 * document that describes a different, unreachable history.
 *
 * FLAGGED FOR JACK: there is no way to REMOVE a criterion or a criterion set
 * through the document, on exactly the same reasoning `criterion-service.ts`
 * gives for having no `deleteCriterion` — a document whose criteria are a
 * strict subset of an existing DRAFT's just leaves the extra ones in place,
 * never deletes them. A "the document is now authoritative, delete anything
 * it does not mention" mode was considered and NOT built: nothing in D-188's
 * text asks for it, and silently deleting a criterion from a re-uploaded
 * document (a person forgetting one line) is a worse failure than leaving an
 * extra one an administrator can still see and remove by hand once a delete
 * path exists.
 *
 * SERVER-ONLY.
 */
import { PermissionDeniedError, requirePermission } from "@/lib/authorization";
import { prisma, type DatabaseClient } from "@/lib/database";
import { ApiError } from "@/lib/errors";

import {
  createAwardType,
  instant,
  updateAwardType,
  type ActorContext,
} from "./award-type-service";
import { createCriterion, updateCriterion } from "./criterion-service";
import {
  createCriterionSet,
  publishCriterionSet,
  updateCriterionSet,
} from "./criterion-set-service";
import {
  findAwardTypeByCode,
  findCriterionByCode,
  findCriterionSetByVersion,
  findGradeValueByCodes,
  gradeValueCodesById,
} from "../infrastructure/catalogue-repository";

const CATALOGUE_DOCUMENT_VERSION = 1;

/** A `GradeValue`, named by its (seeded, install-independent) codes. */
export interface CatalogueGradeRef {
  readonly gradeScale: string;
  readonly grade: string;
}

export interface CatalogueCriterionDocument {
  readonly code: string;
  readonly name: string;
  readonly standard: string | null;
  readonly sequence: number;
  readonly minimumGrade: CatalogueGradeRef | null;
}

export interface CatalogueCriterionSetDocument {
  readonly version: number;
  readonly source: string;
  readonly status: string;
  readonly passFloor: CatalogueGradeRef | null;
  readonly criteria: readonly CatalogueCriterionDocument[];
}

export interface CatalogueAwardTypeDocument {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly issuingBody: string;
  readonly criterionSets: readonly CatalogueCriterionSetDocument[];
}

/** The whole catalogue, in the shape both surfaces of D-188 read and write. */
export interface CatalogueDocument {
  readonly catalogueVersion: number;
  readonly awardTypes: readonly CatalogueAwardTypeDocument[];
}

/**
 * Refused import — always names WHERE in the document the problem is, e.g.
 * `awardTypes[2] (A2).criterionSets[0] (version=1).criteria[3] (A2-4)`. The
 * whole document is rejected with it; nothing is written (see file comment).
 */
export class CatalogueImportError extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = "CatalogueImportError";
  }
}

function fail(path: string, detail: string): never {
  throw new CatalogueImportError(path, detail);
}

/**
 * Runs one call into `award-type-service.ts`/`criterion-set-service.ts`/
 * `criterion-service.ts` and turns whatever it refuses with (`ApiError` from
 * `requiredText`/`requiredEnum`, `CriterionError`, `CriterionSetError`) into a
 * `CatalogueImportError` located at `path` — "validation failed" on a
 * forty-criterion document names nobody; `awardTypes[2].criteria[5]: Must not
 * be empty.` does. `CatalogueImportError` and `PermissionDeniedError` pass
 * through unchanged: the first already names its own location, the second is
 * the guard's own refusal and is never about a document location.
 */
async function via<T>(path: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      error instanceof CatalogueImportError ||
      error instanceof PermissionDeniedError
    ) {
      throw error;
    }
    const detail =
      error instanceof ApiError
        ? [error.message, ...error.details.map((d) => d.issue)].join(" ")
        : error instanceof Error
          ? error.message
          : "Onbekende fout.";
    fail(path, detail);
  }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "Moet een JSON-object zijn.");
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "Moet een lijst zijn.");
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "Moet tekst zijn.");
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "Moet een getal zijn.");
  }
  return value;
}

function expectStringOrNull(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return expectString(value, path);
}

function parseGradeRef(value: unknown, path: string): CatalogueGradeRef | null {
  if (value === null || value === undefined) return null;
  const object = expectObject(value, path);
  return {
    gradeScale: expectString(object.gradeScale, `${path}.gradeScale`),
    grade: expectString(object.grade, `${path}.grade`),
  };
}

function parseCriterion(
  value: unknown,
  path: string,
): CatalogueCriterionDocument {
  const object = expectObject(value, path);
  return {
    code: expectString(object.code, `${path}.code`),
    name: expectString(object.name, `${path}.name`),
    standard: expectStringOrNull(object.standard, `${path}.standard`),
    sequence: expectNumber(object.sequence, `${path}.sequence`),
    minimumGrade: parseGradeRef(object.minimumGrade, `${path}.minimumGrade`),
  };
}

function parseCriterionSet(
  value: unknown,
  path: string,
): CatalogueCriterionSetDocument {
  const object = expectObject(value, path);
  const criteria = expectArray(object.criteria, `${path}.criteria`).map(
    (criterion, index) =>
      parseCriterion(criterion, `${path}.criteria[${index}]`),
  );
  return {
    version: expectNumber(object.version, `${path}.version`),
    source: expectString(object.source, `${path}.source`),
    status: expectString(object.status, `${path}.status`),
    passFloor: parseGradeRef(object.passFloor, `${path}.passFloor`),
    criteria,
  };
}

function parseAwardType(
  value: unknown,
  path: string,
): CatalogueAwardTypeDocument {
  const object = expectObject(value, path);
  const code = expectString(object.code, `${path}.code`);
  const withCode = `${path} (${code})`;
  const criterionSets = expectArray(
    object.criterionSets,
    `${withCode}.criterionSets`,
  ).map((set, index) =>
    parseCriterionSet(set, `${withCode}.criterionSets[${index}]`),
  );
  return {
    code,
    name: expectString(object.name, `${withCode}.name`),
    kind: expectString(object.kind, `${withCode}.kind`),
    issuingBody: expectString(object.issuingBody, `${withCode}.issuingBody`),
    criterionSets,
  };
}

/**
 * Structural parsing ONLY — is this JSON shaped like a catalogue document, so
 * the import loop can safely index into it. Field bounds, enum membership and
 * every business rule (code uniqueness, D-081's versioning, D-080's grade
 * references) are deliberately NOT checked here: they are checked exactly
 * once, by the same services the form uses, inside {@link importCatalogue}'s
 * transaction. See the file comment.
 */
export function parseCatalogueDocument(document: unknown): CatalogueDocument {
  const object = expectObject(document, "(document)");
  const catalogueVersion = expectNumber(
    object.catalogueVersion,
    "catalogueVersion",
  );
  if (catalogueVersion !== CATALOGUE_DOCUMENT_VERSION) {
    fail(
      "catalogueVersion",
      `Alleen documentversie ${CATALOGUE_DOCUMENT_VERSION} wordt ondersteund.`,
    );
  }
  const awardTypes = expectArray(object.awardTypes, "awardTypes").map(
    (awardType, index) => parseAwardType(awardType, `awardTypes[${index}]`),
  );
  return { catalogueVersion, awardTypes };
}

/**
 * The current catalogue (or a named subset), as one JSON document — D-188's
 * export surface. `awardTypeIds`, when given, exports only those award types;
 * omitted, it exports everything.
 */
export async function exportCatalogue(
  actor: ActorContext,
  options: { readonly awardTypeIds?: readonly string[] } = {},
): Promise<CatalogueDocument> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.read",
    { organization: true },
    { at },
  );

  const rows = await prisma.awardType.findMany({
    where: options.awardTypeIds
      ? { id: { in: [...options.awardTypeIds] } }
      : {},
    orderBy: { code: "asc" },
    select: {
      code: true,
      name: true,
      kind: true,
      issuingBody: true,
      criterionSets: {
        orderBy: { version: "asc" },
        select: {
          version: true,
          source: true,
          status: true,
          passFloorGrade: {
            select: { code: true, scale: { select: { code: true } } },
          },
          criteria: {
            orderBy: { sequence: "asc" },
            select: {
              code: true,
              name: true,
              standard: true,
              sequence: true,
              minimumGrade: {
                select: { code: true, scale: { select: { code: true } } },
              },
            },
          },
        },
      },
    },
  });

  return {
    catalogueVersion: CATALOGUE_DOCUMENT_VERSION,
    awardTypes: rows.map((row) => ({
      code: row.code,
      name: row.name,
      kind: row.kind,
      issuingBody: row.issuingBody,
      criterionSets: row.criterionSets.map((set) => ({
        version: set.version,
        source: set.source,
        status: set.status,
        passFloor: set.passFloorGrade
          ? {
              gradeScale: set.passFloorGrade.scale.code,
              grade: set.passFloorGrade.code,
            }
          : null,
        criteria: set.criteria.map((criterion) => ({
          code: criterion.code,
          name: criterion.name,
          standard: criterion.standard,
          sequence: criterion.sequence,
          minimumGrade: criterion.minimumGrade
            ? {
                gradeScale: criterion.minimumGrade.scale.code,
                grade: criterion.minimumGrade.code,
              }
            : null,
        })),
      })),
    })),
  };
}

async function resolveGradeRef(
  ref: CatalogueGradeRef | null,
  path: string,
  tx: DatabaseClient,
): Promise<string | null> {
  if (ref === null) return null;
  const found = await findGradeValueByCodes(ref.gradeScale, ref.grade, tx);
  if (!found) {
    fail(
      path,
      `Onbekende beoordeling "${ref.grade}" op schaal "${ref.gradeScale}" ` +
        "— deze bestaat niet in de (geseede) beoordelingsschaal.",
    );
  }
  return found.id;
}

export interface ImportCatalogueResult {
  readonly awardTypesProcessed: number;
  readonly criterionSetsProcessed: number;
  readonly criteriaProcessed: number;
}

/**
 * D-188's import surface. ALL OR NOTHING: everything below runs inside one
 * transaction, so a refusal anywhere — a shape problem `parseCatalogueDocument`
 * catches up front, or a business-rule refusal any of the underlying services
 * raise partway through — leaves the database exactly as it was. See the file
 * comment for the create/reconcile/verify-unchanged rule per `CriterionSet`
 * status.
 */
export async function importCatalogue(
  actor: ActorContext,
  document: unknown,
): Promise<ImportCatalogueResult> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  // Parsed BEFORE the transaction opens — a shape problem needs no database
  // round trip to detect, and never should have started one.
  const doc = parseCatalogueDocument(document);

  let criterionSetsProcessed = 0;
  let criteriaProcessed = 0;

  await prisma.$transaction(async (tx) => {
    for (const [i, awardTypeDoc] of doc.awardTypes.entries()) {
      const path = `awardTypes[${i}] (${awardTypeDoc.code})`;

      const existingAwardType = await findAwardTypeByCode(
        awardTypeDoc.code,
        tx,
      );

      let awardTypeId: string;
      if (!existingAwardType) {
        const created = await via(path, () =>
          createAwardType(
            actor,
            {
              code: awardTypeDoc.code,
              name: awardTypeDoc.name,
              kind: awardTypeDoc.kind,
              issuingBody: awardTypeDoc.issuingBody,
            },
            tx,
          ),
        );
        awardTypeId = created.id;
      } else {
        if (existingAwardType.kind !== awardTypeDoc.kind) {
          fail(
            path,
            `kind ("${awardTypeDoc.kind}") wijkt af van het bestaande, ` +
              `onveranderlijke kind ("${existingAwardType.kind}") van dit ` +
              "diplomatype (D-188 wijzigt nooit code/kind).",
          );
        }
        awardTypeId = existingAwardType.id;
        await via(path, () =>
          updateAwardType(
            actor,
            awardTypeId,
            { name: awardTypeDoc.name, issuingBody: awardTypeDoc.issuingBody },
            tx,
          ),
        );
      }

      const sortedSets = [...awardTypeDoc.criterionSets].sort(
        (left, right) => left.version - right.version,
      );

      for (const [j, setDoc] of sortedSets.entries()) {
        const setPath = `${path}.criterionSets[${j}] (version=${setDoc.version})`;
        criterionSetsProcessed += 1;

        const existingSet = await findCriterionSetByVersion(
          awardTypeId,
          setDoc.version,
          tx,
        );

        if (!existingSet) {
          const created = await via(setPath, () =>
            createCriterionSet(
              actor,
              awardTypeId,
              { source: setDoc.source },
              tx,
            ),
          );
          const createdRow = await tx.criterionSet.findUnique({
            where: { id: created.id },
            select: { version: true },
          });
          if (!createdRow || createdRow.version !== setDoc.version) {
            fail(
              setPath,
              "de eerstvolgende vrije versie voor dit diplomatype is " +
                `${createdRow?.version ?? "onbekend"}, niet ${setDoc.version} ` +
                "— versienummers moeten aaneengesloten zijn, zonder gaten.",
            );
          }

          const sortedCriteria = [...setDoc.criteria].sort(
            (left, right) => left.sequence - right.sequence,
          );
          for (const [k, criterionDoc] of sortedCriteria.entries()) {
            const criterionPath = `${setPath}.criteria[${k}] (${criterionDoc.code})`;
            criteriaProcessed += 1;
            const minimumGradeId = await resolveGradeRef(
              criterionDoc.minimumGrade,
              `${criterionPath}.minimumGrade`,
              tx,
            );
            await via(criterionPath, () =>
              createCriterion(
                actor,
                created.id,
                {
                  code: criterionDoc.code,
                  name: criterionDoc.name,
                  standard: criterionDoc.standard,
                  sequence: criterionDoc.sequence,
                  minimumGradeId,
                },
                tx,
              ),
            );
          }

          const passFloorGradeId = await resolveGradeRef(
            setDoc.passFloor,
            `${setPath}.passFloor`,
            tx,
          );
          await via(setPath, () =>
            updateCriterionSet(
              actor,
              created.id,
              { source: setDoc.source, passFloorGradeId },
              tx,
            ),
          );

          // "RETIRED" is published exactly like "ACTIVE" — a `CriterionSet`
          // never becomes `RETIRED` directly (there is no such action; only
          // publishing a LATER version does that, as a side effect, in
          // `publishCriterionSet`). So a document whose earlier versions say
          // "RETIRED" is reproduced correctly by publishing every version in
          // ascending order (already this loop's order) and letting each
          // publish retire the one before it — the round-trip case this
          // exists for: an `AwardType` with a history of superseded versions.
          if (setDoc.status === "ACTIVE" || setDoc.status === "RETIRED") {
            await via(setPath, () =>
              publishCriterionSet(actor, created.id, tx),
            );
          } else if (setDoc.status !== "DRAFT") {
            fail(
              setPath,
              `status "${setDoc.status}" kan niet rechtstreeks worden ` +
                'aangemaakt — alleen "DRAFT", "ACTIVE" of "RETIRED".',
            );
          }
          continue;
        }

        // The version already exists. `CriterionSetStatus` on this row
        // decides what an import may still do to it — see the file comment.
        const current = await tx.criterionSet.findUnique({
          where: { id: existingSet.id },
          select: {
            status: true,
            source: true,
            passFloorGradeId: true,
            criteria: {
              select: {
                code: true,
                name: true,
                standard: true,
                sequence: true,
                minimumGradeId: true,
              },
            },
          },
        });
        if (!current) {
          fail(setPath, "onverwacht ontbrekende eisenset tijdens import.");
        }

        if (current.status !== "DRAFT") {
          // D-081: never edited once published. Verify the document agrees
          // with what is already there; refuse outright if it does not,
          // rather than silently accepting a document describing a history
          // this installation never had.
          const passFloorGradeId = await resolveGradeRef(
            setDoc.passFloor,
            `${setPath}.passFloor`,
            tx,
          );
          if (
            current.status !== setDoc.status ||
            current.source !== setDoc.source ||
            current.passFloorGradeId !== passFloorGradeId
          ) {
            fail(
              setPath,
              "deze versie is al gepubliceerd of ingetrokken (D-081) en kan " +
                "niet meer worden gewijzigd, maar de aangeleverde status, " +
                "herkomst of ondergrens wijkt af van wat al vaststaat.",
            );
          }
          for (const [k, criterionDoc] of setDoc.criteria.entries()) {
            const criterionPath = `${setPath}.criteria[${k}] (${criterionDoc.code})`;
            const match = current.criteria.find(
              (row) => row.code === criterionDoc.code,
            );
            const minimumGradeId = await resolveGradeRef(
              criterionDoc.minimumGrade,
              `${criterionPath}.minimumGrade`,
              tx,
            );
            if (
              !match ||
              match.name !== criterionDoc.name ||
              match.standard !== criterionDoc.standard ||
              match.sequence !== criterionDoc.sequence ||
              match.minimumGradeId !== minimumGradeId
            ) {
              fail(
                criterionPath,
                "dit criterium wijkt af van de al gepubliceerde of " +
                  "ingetrokken versie en kan niet worden aangepast (D-081).",
              );
            }
          }
          continue;
        }

        // Still DRAFT: reconcile — create what is missing, correct what
        // exists, matched by `code` (the ordinary form-editor correction
        // path, `updateCriterion`, applied in bulk).
        const sortedCriteria = [...setDoc.criteria].sort(
          (left, right) => left.sequence - right.sequence,
        );
        for (const [k, criterionDoc] of sortedCriteria.entries()) {
          const criterionPath = `${setPath}.criteria[${k}] (${criterionDoc.code})`;
          criteriaProcessed += 1;
          const minimumGradeId = await resolveGradeRef(
            criterionDoc.minimumGrade,
            `${criterionPath}.minimumGrade`,
            tx,
          );
          const existingCriterion = await findCriterionByCode(
            existingSet.id,
            criterionDoc.code,
            tx,
          );
          if (existingCriterion) {
            await via(criterionPath, () =>
              updateCriterion(
                actor,
                existingCriterion.id,
                {
                  code: criterionDoc.code,
                  name: criterionDoc.name,
                  standard: criterionDoc.standard,
                  sequence: criterionDoc.sequence,
                  minimumGradeId,
                },
                tx,
              ),
            );
          } else {
            await via(criterionPath, () =>
              createCriterion(
                actor,
                existingSet.id,
                {
                  code: criterionDoc.code,
                  name: criterionDoc.name,
                  standard: criterionDoc.standard,
                  sequence: criterionDoc.sequence,
                  minimumGradeId,
                },
                tx,
              ),
            );
          }
        }

        const passFloorGradeId = await resolveGradeRef(
          setDoc.passFloor,
          `${setPath}.passFloor`,
          tx,
        );
        await via(setPath, () =>
          updateCriterionSet(
            actor,
            existingSet.id,
            { source: setDoc.source, passFloorGradeId },
            tx,
          ),
        );

        if (setDoc.status === "ACTIVE" || setDoc.status === "RETIRED") {
          await via(setPath, () =>
            publishCriterionSet(actor, existingSet.id, tx),
          );
        }
      }
    }
  });

  return {
    awardTypesProcessed: doc.awardTypes.length,
    criterionSetsProcessed,
    criteriaProcessed,
  };
}

// Re-exported so a caller resolving a `GradeValue.id` it already has (rather
// than a fresh export) can still produce the document's codes — kept here,
// beside the shape it serves, rather than making every caller reach into the
// repository module directly.
export { gradeValueCodesById };
