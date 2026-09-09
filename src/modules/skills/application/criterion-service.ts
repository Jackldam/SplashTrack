/**
 * Creating and correcting a `CriterionSet`'s criteria.
 *
 * A CRITERION IS PART OF ITS SET, AND IS GUARDED AS THE CATALOGUE IS. Both
 * operations guard `{ organization: true }` / `skills.manage_catalogue` — the
 * `award-type-service.ts` file comment explains why there is nothing narrower.
 * `updateCriterion` reads the criterion's `criterionSetId` BEFORE it guards,
 * on the `updateCourseLevel` pattern: it reads one join key to know which
 * set's status to check, and the guard (which needs no resource narrower than
 * the organisation anyway) then decides.
 *
 * THERE IS NO `deleteCriterion`. D-081: a published mistake is fixed in the
 * NEXT version. Within a `DRAFT`, a criterion added by mistake is corrected by
 * editing it — `updateCriterion` — never removed; see
 * `docs/build/phase-2.1-skills-report.md` for why this phase does not build a
 * delete path even pre-publish.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredInt, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  assertSequenceIsFree,
  assertSetIsDraft,
  CriterionError,
  nextSequence,
} from "../domain/criterion";
import { criterionSetOfCriterion } from "../infrastructure/catalogue-repository";
import { SEQUENCE_MAX, TEXT_MAX } from "./input";
import { instant, type ActorContext } from "./award-type-service";

export { CriterionError };

export interface CreateCriterionInput {
  code: unknown;
  name: unknown;
  standard?: unknown;
  sequence?: unknown;
  minimumGradeId?: unknown;
}

/** Adds a criterion to a `DRAFT` set. */
export async function createCriterion(
  actor: ActorContext,
  criterionSetId: string,
  input: CreateCriterionInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const code = requiredText("code", input.code, TEXT_MAX.criterionCode);
  const name = requiredText("name", input.name, TEXT_MAX.criterionName);
  const standard = optionalText(
    "standard",
    input.standard,
    TEXT_MAX.criterionStandard,
  );
  const supplied =
    input.sequence === undefined ||
    input.sequence === null ||
    input.sequence === ""
      ? null
      : requiredInt("sequence", input.sequence, 1, SEQUENCE_MAX);
  const minimumGradeId = optionalText(
    "minimumGradeId",
    input.minimumGradeId,
    TEXT_MAX.id,
  );

  return prisma.$transaction(async (tx) => {
    const set = await tx.criterionSet.findUnique({
      where: { id: criterionSetId },
      select: { status: true },
    });
    if (!set) throw new CriterionError("SET_NOT_DRAFT");
    assertSetIsDraft(set.status);

    const siblings = await tx.criterion.findMany({
      where: { criterionSetId },
      select: { id: true, sequence: true },
    });
    const sequence = supplied ?? nextSequence(siblings);
    assertSequenceIsFree(siblings, sequence, null);

    const criterion = await tx.criterion.create({
      data: { criterionSetId, code, name, standard, sequence, minimumGradeId },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "skills.criterion.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "criterion_set",
        targetId: criterionSetId,
        requestId: actor.requestId ?? null,
        changedFields: {
          criterionId: criterion.id,
          code,
          sequence,
          fields: "code,name,standard,sequence,minimumGradeId",
        },
      },
      tx,
    );

    return criterion;
  });
}

export interface UpdateCriterionInput {
  code: unknown;
  name: unknown;
  standard?: unknown;
  sequence: unknown;
  minimumGradeId?: unknown;
}

/** Corrects a criterion inside its still-`DRAFT` set. */
export async function updateCriterion(
  actor: ActorContext,
  criterionId: string,
  input: UpdateCriterionInput,
): Promise<void> {
  const at = instant(actor);

  const parent = await criterionSetOfCriterion(criterionId);
  // A criterion id naming no row is neither a denial nor an error — the same
  // reading `updateCourseLevel` gives an absent level.
  if (parent === null) return;

  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const code = requiredText("code", input.code, TEXT_MAX.criterionCode);
  const name = requiredText("name", input.name, TEXT_MAX.criterionName);
  const sequence = requiredInt("sequence", input.sequence, 1, SEQUENCE_MAX);
  const standard =
    input.standard === undefined
      ? undefined
      : optionalText("standard", input.standard, TEXT_MAX.criterionStandard);
  const minimumGradeId =
    input.minimumGradeId === undefined
      ? undefined
      : optionalText("minimumGradeId", input.minimumGradeId, TEXT_MAX.id);

  await prisma.$transaction(async (tx) => {
    const before = await tx.criterion.findUnique({
      where: { id: criterionId },
      select: {
        code: true,
        name: true,
        standard: true,
        sequence: true,
        minimumGradeId: true,
        criterionSet: { select: { status: true } },
      },
    });
    if (!before) return;
    assertSetIsDraft(before.criterionSet.status);

    const siblings = await tx.criterion.findMany({
      where: { criterionSetId: parent.criterionSetId },
      select: { id: true, sequence: true },
    });
    assertSequenceIsFree(siblings, sequence, criterionId);

    const changed = [
      ...(before.code === code ? [] : ["code"]),
      ...(before.name === name ? [] : ["name"]),
      ...(standard === undefined || before.standard === standard
        ? []
        : ["standard"]),
      ...(before.sequence === sequence ? [] : ["sequence"]),
      ...(minimumGradeId === undefined ||
      before.minimumGradeId === minimumGradeId
        ? []
        : ["minimumGradeId"]),
    ];
    if (changed.length === 0) return;

    await tx.criterion.update({
      where: { id: criterionId },
      data: { code, name, standard, sequence, minimumGradeId },
    });

    await recordAuditEvent(
      {
        eventType: "skills.criterion.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "criterion_set",
        targetId: parent.criterionSetId,
        requestId: actor.requestId ?? null,
        changedFields: { criterionId, fields: changed.join(",") },
      },
      tx,
    );
  });
}
