/**
 * `AwardType` — the top of the criterion catalogue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY OPERATION GUARDS `{ organization: true }`, AND THAT IS NOT A SHORTCUT
 *
 * `ResourceRef` has no `awardType` member — `@/lib/authorization/scope.ts`
 * names `organization | unit | group | course | session | student | person`,
 * and the design set gives the catalogue no scope type of its own (§2.2's
 * coverage matrix never mentions `AwardType`, `CriterionSet` or `Criterion`).
 * So the only reach that ever covers a catalogue row is `ORGANIZATION`, on the
 * same reasoning `createCourse` already rests its `{ organization: true }`
 * reference on. Every function below states that explicitly rather than
 * resolving a `Reach` and filtering — there is nothing narrower to filter.
 *
 * THE PERMISSIONS ARE §2.5'S, AND THERE ARE ONLY TWO OF THEM THAT APPLY HERE
 *
 * `skills.read` for every read, `skills.manage_catalogue` for every write —
 * the catalogue has no permission of its own for "award types" versus
 * "criterion sets" versus "criteria", on the same reading `courses` gives
 * `courses.manage` for both a course and its levels.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { requiredEnum, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  findAwardTypeDetail,
  listAwardTypes,
  type AwardTypeDetail,
  type AwardTypeListItem,
} from "../infrastructure/catalogue-repository";
import { TEXT_MAX } from "./input";

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

export function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

const AWARD_TYPE_KINDS = ["DIPLOMA", "CERTIFICATE"] as const;
const AWARD_ISSUING_BODIES = ["NRZ", "ORG"] as const;

export async function listAwardTypesForPrincipal(
  actor: ActorContext,
): Promise<AwardTypeListItem[]> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.read",
    { organization: true },
    { at },
  );
  return listAwardTypes();
}

export async function getAwardTypeForPrincipal(
  actor: ActorContext,
  awardTypeId: string,
): Promise<AwardTypeDetail | null> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.read",
    { organization: true },
    { at },
  );
  return findAwardTypeDetail(awardTypeId);
}

export interface CreateAwardTypeInput {
  code: unknown;
  name: unknown;
  kind: unknown;
  issuingBody: unknown;
}

/**
 * Creates an award type. The catalogue's own critical-path row (D-164): every
 * `CriterionSet` an administrator later authors points at one of these.
 */
export async function createAwardType(
  actor: ActorContext,
  input: CreateAwardTypeInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const data = {
    code: requiredText("code", input.code, TEXT_MAX.awardTypeCode),
    name: requiredText("name", input.name, TEXT_MAX.awardTypeName),
    kind: requiredEnum("kind", input.kind, AWARD_TYPE_KINDS),
    issuingBody: requiredEnum(
      "issuingBody",
      input.issuingBody,
      AWARD_ISSUING_BODIES,
    ),
  };

  return prisma.$transaction(async (tx) => {
    const awardType = await tx.awardType.create({
      data,
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "skills.award_type.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "award_type",
        targetId: awardType.id,
        requestId: actor.requestId ?? null,
        // FIELD NAMES, never values — the same restraint `courses.course.created`
        // observes. A diploma name is not personal data, but the trail's habit
        // must not vary by table.
        changedFields: {
          fields: "code,name,kind,issuingBody",
          code: data.code,
        },
      },
      tx,
    );

    return awardType;
  });
}

export interface UpdateAwardTypeInput {
  name: unknown;
  issuingBody: unknown;
}

/**
 * Renames an award type, or corrects who issues it.
 *
 * `code` AND `kind` ARE NOT EDITABLE HERE. `code` is the stable identifier
 * every `CriterionSet.awardTypeId` and `CourseLevel.awardTypeId` points at by
 * id, not by code, so changing it costs nothing structurally — but it is also
 * the identifier an administrator types when cross-referencing a paper NRZ
 * document, and silently rewriting it is a correctness risk this phase does
 * not need to take on. `kind` decides which pass rule a `CriterionSet` under
 * this award type is authored against (D-080); flipping DIPLOMA to CERTIFICATE
 * after criterion sets exist would leave them describing something they no
 * longer are. Both are out of scope for this phase; recorded as an open
 * question in the phase 2.1 report rather than built without a clear need.
 */
export async function updateAwardType(
  actor: ActorContext,
  awardTypeId: string,
  input: UpdateAwardTypeInput,
): Promise<void> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "skills.manage_catalogue",
    { organization: true },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.awardTypeName),
    issuingBody: requiredEnum(
      "issuingBody",
      input.issuingBody,
      AWARD_ISSUING_BODIES,
    ),
  };

  await prisma.$transaction(async (tx) => {
    const before = await tx.awardType.findUnique({
      where: { id: awardTypeId },
      select: { name: true, issuingBody: true },
    });
    if (!before) return;

    const changed = (["name", "issuingBody"] as const).filter(
      (field) => before[field] !== data[field],
    );
    if (changed.length === 0) return;

    await tx.awardType.update({ where: { id: awardTypeId }, data });

    await recordAuditEvent(
      {
        eventType: "skills.award_type.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "award_type",
        targetId: awardTypeId,
        requestId: actor.requestId ?? null,
        changedFields: { fields: changed.join(",") },
      },
      tx,
    );
  });
}
