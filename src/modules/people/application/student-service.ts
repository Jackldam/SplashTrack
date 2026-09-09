/**
 * The pupil — creating a `StudentProfile` and recording its lifecycle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY CREATING A PROFILE IS GUARDED ON THE PERSON AND NOT ON THE PROFILE
 *
 * `requirePermission(..., { student: id })` needs a `StudentProfile` that
 * exists — `homeUnitOfStudent` and `personOfStudent` both resolve from the row.
 * At creation there is no row, so the only honest referent is the PERSON who is
 * about to become a pupil, and `{ person: personId }` is what the guard names.
 *
 * That is not a weaker check: it is the same coverage question one step earlier
 * in the same graph, and a principal who may not reach the person may not make
 * them a pupil either. Once the profile exists, everything about it is guarded
 * as `{ student: profileId }`, which is what `UNIT` reach resolves through the
 * home unit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIFECYCLE LOG IS APPEND-ONLY AND THIS FILE HAS NO UPDATE PATH
 *
 * A correction is a NEW event (`CLAUDE.md` rule 4, D-005). There is no
 * `updateLifecycleEvent` and no `deleteLifecycleEvent` here, and adding one
 * would not be a feature — it would remove the property that makes the history
 * worth keeping.
 *
 * SERVER-ONLY.
 */
import {
  PermissionDeniedError,
  requirePermission,
  resolveReach,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

import {
  DuplicateNumberError,
  isDuplicateNumber,
  nextAllocatedNumber,
  normaliseSuppliedNumber,
  STUDENT_NUMBER_PREFIX,
} from "../domain/numbering";
import type { StudentLifecycleEventType } from "../domain/student-lifecycle";
import { ensurePeopleRegistrations } from "../infrastructure/registrations";
import {
  findStudentCandidates,
  ReachCoversNoStudentError,
  type StudentCandidate,
} from "../infrastructure/student-candidate-repository";
import {
  optionalDate,
  optionalText,
  requiredEnum,
  requiredText,
  TEXT_MAX,
} from "./input";
import type { ActorContext } from "./people-service";

/** The five types, as a value the form and the validator both read. */
export const LIFECYCLE_EVENT_TYPES = [
  "JOINED",
  "PAUSED",
  "LEFT",
  "RETURNED",
  "TRIAL_ATTENDED",
] as const satisfies readonly StudentLifecycleEventType[];

/**
 * Registers a person as a pupil — *leerling* — and records the event that says
 * so.
 *
 * ONE PROFILE PER PERSON, PERSISTENT (D-059). `personId` is unique, so a
 * returning swimmer cannot acquire a second profile even by accident: they get
 * a `RETURNED` event on the profile that already holds their skills, their
 * diplomas and their previous groups, which is the history the product exists
 * to keep.
 *
 * The opening event defaults to `JOINED`. A club recording a trial lesson for a
 * prospective pupil passes `TRIAL_ATTENDED` instead — *proefzwemmen* is an
 * enrolment concept, not a rehearsal before an exam (`docs/glossary.md`).
 */
export async function createStudentProfile(
  actor: ActorContext,
  personId: string,
  input: {
    studentNumber?: unknown;
    unitId?: unknown;
    openingEvent?: unknown;
    occurredAt?: unknown;
  } = {},
): Promise<{ studentProfileId: string; studentNumber: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "students.create",
    { person: personId },
    { at },
  );

  const supplied = optionalText("studentNumber", input.studentNumber, 32);
  const unitId = optionalText("unitId", input.unitId, 64);
  const openingEvent = input.openingEvent
    ? requiredEnum("openingEvent", input.openingEvent, LIFECYCLE_EVENT_TYPES)
    : ("JOINED" as const);
  const occurredAt = optionalDate("occurredAt", input.occurredAt) ?? at;

  return prisma.$transaction(async (tx) => {
    const studentNumber = supplied
      ? normaliseSuppliedNumber("studentNumber", supplied)
      : nextAllocatedNumber(
          STUDENT_NUMBER_PREFIX,
          (
            await tx.studentProfile.findMany({
              select: { studentNumber: true },
            })
          ).map((row) => row.studentNumber),
        );

    const profile = await tx.studentProfile.create({
      data: {
        personId,
        studentNumber,
        unitId,
        lifecycleEvents: { create: { type: openingEvent, occurredAt } },
      },
      select: { id: true, studentNumber: true },
    });

    await recordAuditEvent(
      {
        eventType: "people.student_profile.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: profile.id,
        requestId: actor.requestId ?? null,
        changedFields: {
          personId,
          numberSource: supplied ? "supplied" : "allocated",
          openingEvent,
          unitAssigned: unitId !== null,
        },
      },
      tx,
    );

    return {
      studentProfileId: profile.id,
      studentNumber: profile.studentNumber,
    };
  });
}

export interface UpdateStudentProfileInput {
  studentNumber: unknown;
}

/**
 * Corrects the pupil number — the one column `createStudentProfile` writes by
 * hand and this file otherwise never lets anyone touch again.
 *
 * THE OPERATION THAT WAS MISSING (`create-correction-pairing.test.ts`):
 * `studentNumber` is administrator-supplied the same way `memberNumber` is
 * (`prisma/schema.prisma`), and until now had no way back from a typo short
 * of editing the database directly.
 *
 * `students.update`, over `{ student: studentProfileId }` — once the profile
 * exists everything about it is guarded through the profile itself (see
 * `people-service.ts`'s header), which is the same reference
 * `recordLifecycleEvent` already checks. Not `{ person: personId }`: that
 * reference is only honest before the profile exists, which is exactly the
 * `createStudentProfile` case and not this one.
 *
 * Nothing is written when the number did not actually change.
 */
export async function updateStudentProfile(
  actor: ActorContext,
  studentProfileId: string,
  input: UpdateStudentProfileInput,
): Promise<void> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "students.update",
    { student: studentProfileId },
    { at },
  );

  const studentNumber = normaliseSuppliedNumber(
    "studentNumber",
    requiredText("studentNumber", input.studentNumber, 32),
  );

  try {
    await prisma.$transaction(async (tx) => {
      const profile = await tx.studentProfile.findUnique({
        where: { id: studentProfileId },
        select: { studentNumber: true },
      });
      if (!profile) {
        throw new Error("That pupil profile does not exist.");
      }
      if (profile.studentNumber === studentNumber) return;

      await tx.studentProfile.update({
        where: { id: studentProfileId },
        data: { studentNumber },
      });

      await recordAuditEvent(
        {
          eventType: "people.student_profile.corrected",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          targetType: "student_profile",
          targetId: studentProfileId,
          requestId: actor.requestId ?? null,
          changedFields: { fields: "studentNumber" },
        },
        tx,
      );
    });
  } catch (error) {
    if (isDuplicateNumber(error)) {
      throw new DuplicateNumberError("studentNumber", studentNumber);
    }
    throw error;
  }
}

/**
 * Appends one lifecycle event.
 *
 * `occurredAt` is WHEN IT HAPPENED, not when it was typed in — a club catching
 * up on Monday morning enters Saturday's departure with Saturday's date, and
 * the derived state has to agree with the club's own account of its week.
 * `createdAt` records the entry moment beside it.
 *
 * `reason` is short free text and is NOT encrypted: D-148's protected class is
 * medical remarks, pastoral notes, assessment remarks and inquiry text, and a
 * lifecycle reason is not in it. What keeps that honest is the bound, the
 * purpose line at the capture point, and `students.notes.*` existing for
 * anything that is actually a note about the child.
 */
export async function recordLifecycleEvent(
  actor: ActorContext,
  studentProfileId: string,
  input: { type: unknown; occurredAt?: unknown; reason?: unknown },
): Promise<{ eventId: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "students.update",
    { student: studentProfileId },
    { at },
  );

  const type = requiredEnum("type", input.type, LIFECYCLE_EVENT_TYPES);
  const occurredAt = optionalDate("occurredAt", input.occurredAt) ?? at;
  const reason = optionalText("reason", input.reason, TEXT_MAX.reason);

  return prisma.$transaction(async (tx) => {
    const event = await tx.studentLifecycleEvent.create({
      data: { studentProfileId, type, occurredAt, reason },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "people.student_lifecycle_event.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_lifecycle_event",
        targetId: event.id,
        requestId: actor.requestId ?? null,
        changedFields: {
          studentProfileId,
          // The TYPE is a machine token from a closed set, not personal data,
          // and it is the fact an auditor is looking for: this is the trail
          // that answers "when was this child recorded as having left".
          type,
          reasonGiven: reason !== null,
        },
      },
      tx,
    );

    return { eventId: event.id };
  });
}

/**
 * The pupils this caller may CHOOSE from, by name — the guest picker's data
 * (phase 2.2 decision round, item 4's follow-up: the lesson screen's guest
 * form must not ask an instructor to type a database id).
 *
 * The `listPeopleForPrincipal` shape one entity over: no `requirePermission`,
 * because a list names no single resource for D-030's reference to point at —
 * the authority is the `Reach` this resolves for `students.read`, which the
 * repository narrows by per row (`student-candidate-filter.ts`; every branch
 * mirrors or narrows `coversResource({ student })`, live rules included). A
 * reach that covers no pupil at all is a DENIAL, never an empty list.
 *
 * Returns identity basics only — a name and the student number an instructor
 * cross-checks — never the profile itself; picking a pupil grants nothing,
 * because whatever is done with the picked id is guarded by its own service.
 */
export async function listStudentCandidatesForPrincipal(
  actor: ActorContext,
  options: { query?: unknown } = {},
): Promise<StudentCandidate[]> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  const query = optionalText("query", options.query, TEXT_MAX.query);
  const reach = await resolveReach(actor.principal, "students.read", { at });
  try {
    return await findStudentCandidates(reach, at, query);
  } catch (error) {
    if (error instanceof ReachCoversNoStudentError) {
      throw new PermissionDeniedError("students.read", "student candidates");
    }
    throw error;
  }
}
