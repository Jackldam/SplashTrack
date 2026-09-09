/**
 * `AttendanceEvent` — the append-only register of who showed up
 * (`01-domain-model.md` §3.4; D-005, D-061).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITES GUARD `{ session: sessionId }` — THE SESSION, NOT THE GROUP, AND
 * THAT IS D-179 DOING THE CHOOSING
 *
 * §2.2 opens with `requirePermission(session, 'attendance.record', { group:
 * groupId })` as its illustration, and `recordSkillProgress` took that shape
 * literally. This module does not, deliberately: attendance is recorded
 * against a LESSON, and the person recording it is not always the group's
 * instructor — D-179's make-up guest brings a `SESSION`-scoped substitute or
 * a receiving instructor whose only relationship with the child is that
 * session's roster. A `{ group }` guard would deny exactly them. `{ session }`
 * loses nothing in the other direction: `GROUP` coverage includes "that
 * group, its scheduled sessions" (§2.2's own matrix), so the ordinary
 * instructor passes the same guard. The divergence from the doc's example is
 * recorded in the phase 2.2 report.
 *
 * `attendance.record` for a fresh registration, `attendance.amend` for a
 * correction — §2.5's actual pair, applied literally at last (skills borrowed
 * this split for `skills.assess`/`skills.revoke`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE GROUP REGISTRATION IS ONE TRANSACTION, AND ONE AUDIT EVENT
 *
 * `01-domain-model.md` §4: *"Registering attendance for a group writes all
 * records in one transaction. Partial attendance is not a valid state."* And
 * D-126: ONE audit event per aggregate write — one for the registration, not
 * thirty — because `AuditEvent` appends serialize on an advisory lock, and
 * per-student attribution lives in the attendance events themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `clientEventId` MAKES EVERY WRITE IDEMPOTENT (P-02)
 *
 * A retry, a double-tap or a replayed offline queue arrives carrying the same
 * client-generated ids. Entries whose `clientEventId` already exists are
 * SKIPPED (the original row stands — replaying never edits, because nothing
 * here edits); only the rest are inserted. The unique index is the backstop
 * against the race this check cannot see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READS GUARD `{ session }` FOR THE REGISTER, `{ student }` + REACH-NARROWING
 * FOR THE HISTORY — the `getSkillProgressForStudent` shape, unchanged. Only
 * the `GROUP` variant narrows; `attendance-reach-filter.ts` records why.
 *
 * SERVER-ONLY.
 */
import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalText, requiredEnum, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";
import { findSessionRegisterFacts } from "@/modules/sessions";

import {
  ATTENDANCE_STATES,
  AttendanceError,
  effectiveAttendanceByStudent,
  type AttendanceStateValue,
  type EffectiveAttendance,
} from "../domain/attendance-event";
import {
  findAttendanceForStudent,
  findSessionAttendance,
  type SessionAttendanceEvent,
  type StudentAttendanceEntry,
} from "../infrastructure/attendance-repository";
import { REGISTER_MAX_ENTRIES, TEXT_MAX } from "./input";

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export { ATTENDANCE_STATES, AttendanceError };
export type { AttendanceStateValue };

/** One pupil's observation inside a registration. */
export interface RegisterAttendanceEntry {
  studentProfileId: unknown;
  state: unknown;
  clientEventId: unknown;
  note?: unknown;
}

export interface RegisterSessionAttendanceInput {
  entries: readonly RegisterAttendanceEntry[];
}

export interface RegistrationReport {
  /** Events this call appended. */
  readonly created: number;
  /** Entries skipped because their `clientEventId` already existed (P-02). */
  readonly replayed: number;
}

interface ValidatedEntry {
  readonly studentProfileId: string;
  readonly state: AttendanceStateValue;
  readonly clientEventId: string;
  readonly note: string | null;
}

function validateEntries(
  entries: readonly RegisterAttendanceEntry[],
): ValidatedEntry[] {
  if (entries.length === 0) throw new AttendanceError("NOTHING_TO_REGISTER");
  if (entries.length > REGISTER_MAX_ENTRIES) {
    // The same failure class as any other out-of-bounds input.
    throw new AttendanceError("NOTHING_TO_REGISTER");
  }

  const seenStudents = new Set<string>();
  const validated: ValidatedEntry[] = [];
  for (const entry of entries) {
    const studentProfileId = requiredText(
      "studentProfileId",
      entry.studentProfileId,
      TEXT_MAX.id,
    );
    if (seenStudents.has(studentProfileId)) {
      throw new AttendanceError("DUPLICATE_PUPIL");
    }
    seenStudents.add(studentProfileId);

    validated.push({
      studentProfileId,
      state: requiredEnum<AttendanceStateValue>(
        "state",
        entry.state,
        ATTENDANCE_STATES,
      ),
      clientEventId: requiredText(
        "clientEventId",
        entry.clientEventId,
        TEXT_MAX.clientEventId,
      ),
      note: optionalText("note", entry.note, TEXT_MAX.note),
    });
  }
  return validated;
}

/**
 * Registers attendance for one lesson — the whole register, one transaction.
 *
 * Every pupil must be on the session's EFFECTIVE roster (`sessions`'
 * published answer: group members on the lesson's date plus explicit
 * entries). A child who swam along from another group is a GUEST first
 * (D-179, `addGuestToSession`) and registrable through that row — never
 * silently registrable outside it. Appends only; a wrong state is corrected
 * with {@link amendAttendance}, not by calling this twice.
 */
export async function registerSessionAttendance(
  actor: ActorContext,
  sessionId: string,
  input: RegisterSessionAttendanceInput,
): Promise<RegistrationReport> {
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "attendance.record",
    { session: sessionId },
    { at },
  );

  const entries = validateEntries(input.entries);

  const session = await findSessionRegisterFacts(sessionId);
  if (session === null) throw new AttendanceError("SESSION_NOT_FOUND");
  if (session.status === "CANCELLED") {
    throw new AttendanceError("SESSION_CANCELLED");
  }

  const roster = new Set(session.rosterStudentProfileIds);
  for (const entry of entries) {
    if (!roster.has(entry.studentProfileId)) {
      throw new AttendanceError("NOT_ON_ROSTER");
    }
  }

  return prisma.$transaction(async (tx) => {
    // P-02: entries already written by an earlier attempt are skipped, never
    // rewritten. The unique index backstops the race between this read and
    // the insert below.
    const existing = await tx.attendanceEvent.findMany({
      where: { clientEventId: { in: entries.map((e) => e.clientEventId) } },
      select: { clientEventId: true },
    });
    const replayedIds = new Set(existing.map((row) => row.clientEventId));
    const fresh = entries.filter((e) => !replayedIds.has(e.clientEventId));

    if (fresh.length > 0) {
      await tx.attendanceEvent.createMany({
        data: fresh.map((entry) => ({
          sessionId,
          studentProfileId: entry.studentProfileId,
          state: entry.state,
          recordedByPersonId: actor.principal.personId,
          recordedAt: at,
          clientEventId: entry.clientEventId,
          // The read-side narrowing snapshot (D-145 rule 2), stamped from the
          // session fact the guard above already covered — never re-derived.
          groupId: session.groupId,
          note: entry.note,
        })),
      });

      // D-126: ONE audit event for the whole registration. Per-student
      // attribution is the attendance events' own job — they carry the actor.
      await recordAuditEvent(
        {
          eventType: "attendance.registered",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          targetType: "scheduled_session",
          targetId: sessionId,
          requestId: actor.requestId ?? null,
          // COUNTS AND ONE CLOSED-VOCABULARY BREAKDOWN — never the notes
          // (D-148-adjacent restraint, the `skills.progress.recorded`
          // precedent). Flat keys because `changedFields` values are scalars.
          changedFields: {
            groupId: session.groupId,
            created: fresh.length,
            replayed: replayedIds.size,
            ...Object.fromEntries(
              ATTENDANCE_STATES.map((state) => [
                `state_${state}`,
                fresh.filter((e) => e.state === state).length,
              ]),
            ),
          },
        },
        tx,
      );
    }

    return { created: fresh.length, replayed: replayedIds.size };
  });
}

export interface AmendAttendanceInput {
  studentProfileId: unknown;
  state: unknown;
  clientEventId: unknown;
  supersedesEventId: unknown;
  note?: unknown;
}

/**
 * Corrects one observation — D-061 verbatim: a NEW event carrying
 * `supersedesEventId`; the superseded row is never modified (and with the
 * database grants of `attendanceGrantStatements`, cannot be).
 *
 * The superseded event must belong to THIS session and THIS pupil — the one
 * cross-row rule the CHECK constraint cannot state. There is deliberately no
 * roster re-check here: the child may have left the group since the lesson,
 * and the correction is about what happened, not about who belongs now.
 */
export async function amendAttendance(
  actor: ActorContext,
  sessionId: string,
  input: AmendAttendanceInput,
): Promise<{ id: string }> {
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "attendance.amend",
    { session: sessionId },
    { at },
  );

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const state = requiredEnum<AttendanceStateValue>(
    "state",
    input.state,
    ATTENDANCE_STATES,
  );
  const clientEventId = requiredText(
    "clientEventId",
    input.clientEventId,
    TEXT_MAX.clientEventId,
  );
  const supersedesEventId = requiredText(
    "supersedesEventId",
    input.supersedesEventId,
    TEXT_MAX.id,
  );
  const note = optionalText("note", input.note, TEXT_MAX.note);

  return prisma.$transaction(async (tx) => {
    // P-02, the amend path: a replayed correction returns the row the first
    // attempt wrote, and writes nothing.
    const replay = await tx.attendanceEvent.findUnique({
      where: { clientEventId },
      select: { id: true },
    });
    if (replay !== null) return { id: replay.id };

    // The cross-row half of D-061's rule, checked INSIDE the transaction that
    // writes (the `updateCriterionSet` convention: re-check where it counts).
    const superseded = await tx.attendanceEvent.findUnique({
      where: { id: supersedesEventId },
      select: { sessionId: true, studentProfileId: true },
    });
    if (
      superseded === null ||
      superseded.sessionId !== sessionId ||
      superseded.studentProfileId !== studentProfileId
    ) {
      throw new AttendanceError("SUPERSEDED_EVENT_MISMATCH");
    }

    // The group snapshot comes from the session, exactly as registration
    // stamps it — a correction is visible to the same reaches the original is.
    const session = await tx.scheduledSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { groupId: true },
    });

    const created = await tx.attendanceEvent.create({
      data: {
        sessionId,
        studentProfileId,
        state,
        recordedByPersonId: actor.principal.personId,
        recordedAt: at,
        clientEventId,
        supersedesEventId,
        groupId: session.groupId,
        note,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "attendance.amended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          studentProfileId,
          eventId: created.id,
          supersedesEventId,
          state,
          noteGiven: note !== null,
        },
      },
      tx,
    );

    return created;
  });
}

/** One pupil's line of the register screen. */
export interface RegisterLine {
  readonly studentProfileId: string;
  /** `null` when nothing has been registered for this pupil yet. */
  readonly effective: EffectiveAttendance | null;
}

export interface SessionRegister {
  readonly sessionId: string;
  readonly groupId: string;
  readonly status: "SCHEDULED" | "CANCELLED";
  /** One line per roster member, in the roster's own order. */
  readonly lines: readonly RegisterLine[];
  /** Every event, in write order — the correction form and the history view. */
  readonly events: readonly SessionAttendanceEvent[];
}

/**
 * One lesson's register: the effective answer per roster member, plus the
 * full event history D-061 keeps. A pupil with events who is no longer on the
 * roster (a guest row removed after the fact) still appears — evidence does
 * not disappear because the roster changed.
 */
export async function getSessionRegister(
  actor: ActorContext,
  sessionId: string,
): Promise<SessionRegister> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "attendance.read",
    { session: sessionId },
    { at },
  );

  const session = await findSessionRegisterFacts(sessionId);
  if (session === null) throw new AttendanceError("SESSION_NOT_FOUND");

  const events = await findSessionAttendance(sessionId);
  const effective = effectiveAttendanceByStudent(events);

  const lineIds = new Set(session.rosterStudentProfileIds);
  for (const eventStudent of effective.keys()) lineIds.add(eventStudent);

  return {
    sessionId,
    groupId: session.groupId,
    status: session.status,
    lines: [...lineIds].map((studentProfileId) => ({
      studentProfileId,
      effective: effective.get(studentProfileId) ?? null,
    })),
    events,
  };
}

/**
 * A pupil's attendance history, most recent lesson first, narrowed to what
 * the caller's `Reach` covers. See `attendance-reach-filter.ts` for which
 * reaches narrow (only `GROUP`) and why.
 */
export async function getAttendanceForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<StudentAttendanceEntry[]> {
  const at = instant(actor);
  const reach = await requirePermission(
    actor.principal,
    "attendance.read",
    { student: studentProfileId },
    { at },
  );
  return findAttendanceForStudent(studentProfileId, reach);
}
