/**
 * `PersonQualification` — *"een leraar die bevoegd is binnen de vereniging"*
 * (`15-…` §2.1). What D-085's `assessorPersonId holds a valid
 * PersonQualification` clause checks, now that the table exists.
 *
 * Guarded by `exams.manage` on `{ person }` — the same permission that
 * administers the module's other configuration (candidacy, results),
 * reused here rather than a new key: no chapter in the design set names a
 * SEPARATE permission for granting a qualification, and `exams.manage`'s own
 * catalogue entry is broad enough to cover it (`02-security-privacy.md`
 * §2.5's existing `exams.*` group).
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalDate, requiredDate, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { TEXT_MAX } from "./input";
import {
  findQualificationById,
  findQualificationsForPerson,
  hasValidQualification,
  type PersonQualificationView,
} from "../infrastructure/person-qualification-repository";

export {
  findQualificationsForPerson as listQualifications,
  hasValidQualification,
};
export type { PersonQualificationView };

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export type PersonQualificationRefusal =
  "QUALIFICATION_NOT_FOUND" | "ALREADY_ENDED" | "INVALID_WINDOW";

export class PersonQualificationError extends Error {
  constructor(public readonly reason: PersonQualificationRefusal) {
    super(MESSAGES[reason]);
    this.name = "PersonQualificationError";
  }
}

const MESSAGES: Record<PersonQualificationRefusal, string> = {
  QUALIFICATION_NOT_FOUND: "Deze bevoegdheid bestaat niet.",
  ALREADY_ENDED: "Deze bevoegdheid is al beëindigd.",
  INVALID_WINDOW: "De einddatum ligt voor de begindatum.",
};

export interface GrantQualificationInput {
  personId: unknown;
  type: unknown;
  validFrom?: unknown;
  validTo?: unknown;
}

/** Records that a person is *bevoegd* — one row, an open-ended interval. */
export async function grantQualification(
  actor: ActorContext,
  input: GrantQualificationInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const personId = requiredText("personId", input.personId, TEXT_MAX.id);
  const type = requiredText("type", input.type, TEXT_MAX.qualificationType);
  const validFrom =
    input.validFrom === undefined ||
    input.validFrom === null ||
    input.validFrom === ""
      ? at
      : requiredDate("validFrom", input.validFrom);
  const validTo = optionalDate("validTo", input.validTo);

  if (validTo !== null && validTo <= validFrom) {
    throw new PersonQualificationError("INVALID_WINDOW");
  }

  await requirePermission(
    actor.principal,
    "exams.manage",
    { person: personId },
    { at },
  );

  return prisma.$transaction(async (tx) => {
    const row = await tx.personQualification.create({
      data: {
        personId,
        type,
        validFrom,
        validTo,
        grantedByPersonId: actor.principal.personId,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "exams.qualification.granted",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person",
        targetId: personId,
        requestId: actor.requestId ?? null,
        changedFields: {
          qualificationId: row.id,
          type,
          validFrom: validFrom.toISOString(),
          validTo: validTo?.toISOString() ?? null,
        },
      },
      tx,
    );

    return { id: row.id };
  });
}

export interface EndQualificationInput {
  qualificationId: unknown;
  validTo?: unknown;
}

/**
 * Ends a qualification early — an ordinary mutation of `validTo`, the
 * `MembershipPeriod`/`endInstructorAssignment` shape. Never a delete: the
 * historical fact "this person was bevoegd from X to Y" survives.
 */
export async function endQualification(
  actor: ActorContext,
  input: EndQualificationInput,
): Promise<void> {
  const at = instant(actor);
  const qualificationId = requiredText(
    "qualificationId",
    input.qualificationId,
    TEXT_MAX.id,
  );
  const validTo =
    input.validTo === undefined ||
    input.validTo === null ||
    input.validTo === ""
      ? at
      : requiredDate("validTo", input.validTo);

  const existing = await findQualificationById(qualificationId);
  if (existing === null) {
    throw new PersonQualificationError("QUALIFICATION_NOT_FOUND");
  }

  await requirePermission(
    actor.principal,
    "exams.manage",
    { person: existing.personId },
    { at },
  );

  if (existing.validTo !== null && existing.validTo <= at) {
    throw new PersonQualificationError("ALREADY_ENDED");
  }
  if (validTo <= existing.validFrom) {
    throw new PersonQualificationError("INVALID_WINDOW");
  }

  await prisma.$transaction(async (tx) => {
    await tx.personQualification.update({
      where: { id: qualificationId },
      data: { validTo },
    });

    await recordAuditEvent(
      {
        eventType: "exams.qualification.ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person",
        targetId: existing.personId,
        requestId: actor.requestId ?? null,
        changedFields: { qualificationId, validTo: validTo.toISOString() },
      },
      tx,
    );
  });
}
