/**
 * Authoring a `CriterionSet` — D-081's versioning, D-164's "never seeded".
 *
 * `{ organization: true }`, `skills.manage_catalogue` — see
 * `award-type-service.ts`'s file comment for why there is nothing narrower to
 * guard on.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma, type DatabaseClient } from "@/lib/database";
import { optionalText, requiredEnum } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  assertCanPublish,
  CriterionSetError,
  nextVersion,
} from "../domain/criterion-set";
import {
  findCriterionSetDetail,
  findOpenDraft,
  listCriterionSetVersions,
  type CriterionSetDetail,
} from "../infrastructure/catalogue-repository";
import { TEXT_MAX } from "./input";
import { instant, type ActorContext } from "./award-type-service";

export { CriterionSetError };

const CRITERION_SET_SOURCES = ["NRZ", "ORG"] as const;

export async function getCriterionSetForPrincipal(
  actor: ActorContext,
  criterionSetId: string,
): Promise<CriterionSetDetail | null> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.read",
    { organization: true },
    { at },
  );
  return findCriterionSetDetail(criterionSetId);
}

export interface CreateCriterionSetInput {
  source: unknown;
}

/**
 * Opens a new `DRAFT` version — version 1 for a brand-new `AwardType`, or the
 * next one after the previous `ACTIVE` version is superseded.
 *
 * REFUSES A SECOND OPEN DRAFT. One thing being composed at a time, so "which
 * draft is the real one" never has two answers — `CriterionSetError` carries
 * the existing draft's id so the caller can redirect there instead of
 * reporting a bare refusal.
 */
export async function createCriterionSet(
  actor: ActorContext,
  awardTypeId: string,
  input: CreateCriterionSetInput,
  client: DatabaseClient = prisma,
): Promise<{ id: string }> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const source = requiredEnum("source", input.source, CRITERION_SET_SOURCES);

  // Both reads moved INSIDE the transaction below (against `tx`, not
  // `client`/the module-level `prisma`), so a caller composing this into a
  // bigger transaction — the JSON importer creating several versions of one
  // `AwardType` in a single upload — sees its own not-yet-committed writes.
  const run = async (tx: DatabaseClient) => {
    const openDraft = await findOpenDraft(awardTypeId, tx);
    if (openDraft) throw new CriterionSetError("NOT_DRAFT");

    const versions = await listCriterionSetVersions(awardTypeId, tx);
    const version = nextVersion(versions);

    const set = await tx.criterionSet.create({
      data: { awardTypeId, version, source, status: "DRAFT" },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "skills.criterion_set.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "award_type",
        targetId: awardTypeId,
        requestId: actor.requestId ?? null,
        changedFields: { criterionSetId: set.id, version, source },
      },
      tx,
    );

    return set;
  };

  return client === prisma ? prisma.$transaction(run) : run(client);
}

export interface UpdateCriterionSetInput {
  source: unknown;
  passFloorGradeId: unknown;
}

/**
 * Edits a `DRAFT` — its provenance label and its pass floor. Refuses outside
 * `DRAFT` (D-081: "an ACTIVE set is never edited").
 */
export async function updateCriterionSet(
  actor: ActorContext,
  criterionSetId: string,
  input: UpdateCriterionSetInput,
  client: DatabaseClient = prisma,
): Promise<void> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const source = requiredEnum("source", input.source, CRITERION_SET_SOURCES);
  const passFloorGradeId = optionalText(
    "passFloorGradeId",
    input.passFloorGradeId,
    TEXT_MAX.id,
  );

  const run = async (tx: DatabaseClient) => {
    const before = await tx.criterionSet.findUnique({
      where: { id: criterionSetId },
      select: { source: true, status: true, passFloorGradeId: true },
    });
    if (!before) return;
    if (before.status !== "DRAFT") throw new CriterionSetError("NOT_DRAFT");

    const changed = [
      ...(before.source === source ? [] : ["source"]),
      ...(before.passFloorGradeId === passFloorGradeId
        ? []
        : ["passFloorGradeId"]),
    ];
    if (changed.length === 0) return;

    await tx.criterionSet.update({
      where: { id: criterionSetId },
      data: { source, passFloorGradeId },
    });

    await recordAuditEvent(
      {
        eventType: "skills.criterion_set.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "criterion_set",
        targetId: criterionSetId,
        requestId: actor.requestId ?? null,
        changedFields: { fields: changed.join(",") },
      },
      tx,
    );
  };

  return client === prisma ? prisma.$transaction(run) : run(client);
}

/**
 * Publishes a `DRAFT` — D-081's transition. In one transaction: this set
 * becomes `ACTIVE` with `effectiveFrom = now`, and the `AwardType`'s previous
 * `ACTIVE` version (if any) becomes `RETIRED` with `effectiveTo = now`.
 *
 * `CriterionSet_one_active_per_award_type_key` (the migration's partial unique
 * index) is the control against a second publish racing this one; the checks
 * in `assertCanPublish` are the sentence an administrator reads instead of a
 * Postgres error.
 */
export async function publishCriterionSet(
  actor: ActorContext,
  criterionSetId: string,
  client: DatabaseClient = prisma,
): Promise<void> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const run = async (tx: DatabaseClient) => {
    const row = await tx.criterionSet.findUnique({
      where: { id: criterionSetId },
      select: {
        awardTypeId: true,
        status: true,
        passFloorGradeId: true,
        _count: { select: { criteria: true } },
      },
    });
    if (!row) return;
    const set = {
      awardTypeId: row.awardTypeId,
      status: row.status,
      passFloorGradeId: row.passFloorGradeId,
      criterionCount: row._count.criteria,
    };
    assertCanPublish(set);

    const previousActive = await tx.criterionSet.findFirst({
      where: { awardTypeId: set.awardTypeId, status: "ACTIVE" },
      select: { id: true },
    });

    if (previousActive) {
      await tx.criterionSet.update({
        where: { id: previousActive.id },
        data: { status: "RETIRED", effectiveTo: at },
      });
    }

    await tx.criterionSet.update({
      where: { id: criterionSetId },
      data: { status: "ACTIVE", effectiveFrom: at },
    });

    await recordAuditEvent(
      {
        eventType: "skills.criterion_set.published",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "criterion_set",
        targetId: criterionSetId,
        requestId: actor.requestId ?? null,
        changedFields: {
          awardTypeId: set.awardTypeId,
          retiredPreviousVersion: previousActive !== null,
        },
      },
      tx,
    );
  };

  return client === prisma ? prisma.$transaction(run) : run(client);
}
