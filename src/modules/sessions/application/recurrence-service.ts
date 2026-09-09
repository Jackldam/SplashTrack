/**
 * The rules a timetable is generated from, and the dates it skips.
 *
 * Both concepts are ADDITIONS to the design set — nothing in any chapter creates
 * a `ScheduledSession` — so `../domain/recurrence.ts` carries the reasoning and
 * `docs/build/phase-1.6-groups-and-sessions-report.md` records them as additions
 * rather than as something a decision asked for.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  optionalDate,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
  requiredTimeOfDay,
} from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { ensureSessionsRegistrations } from "../infrastructure/registrations";
import { toIsoDate } from "../domain/zoned-time";
import { TEXT_MAX } from "./input";
import type { ActorContext } from "./schedule-service";

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface CreateRecurrenceInput {
  poolId?: unknown;
  weekday: unknown;
  startTime: unknown;
  durationMinutes: unknown;
  startsOn: unknown;
  endsOn?: unknown;
}

/**
 * Adds a weekly rule to a group.
 *
 * A GROUP MAY HAVE MORE THAN ONE, and nothing here refuses a second: a group
 * swimming Tuesday and Thursday is two rules. That question went to the domain
 * expert unanswered; several subsumes one, so if the answer turns out to be
 * "always exactly one slot", the change is a screen that offers one and not a
 * migration.
 *
 * The time arrives as `HH:MM` from an `<input type="time">` and is stored as
 * minutes past LOCAL midnight — never as an instant. See
 * `../domain/zoned-time.ts` for why: 18:00 is a different instant in March and
 * in May, and both fall inside a swimming season.
 */
export async function createRecurrence(
  actor: ActorContext,
  groupId: string,
  input: CreateRecurrenceInput,
): Promise<{ id: string }> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { group: groupId },
    { at },
  );

  const data = {
    groupId,
    poolId: optionalText("poolId", input.poolId, 40),
    weekday: requiredInt("weekday", input.weekday, 1, 7),
    startMinuteOfDay: requiredTimeOfDay("startTime", input.startTime),
    durationMinutes: requiredInt(
      "durationMinutes",
      input.durationMinutes,
      1,
      1440,
    ),
    startsOn: requiredDate("startsOn", input.startsOn),
    endsOn: optionalDate("endsOn", input.endsOn),
  };

  return prisma.$transaction(async (tx) => {
    const recurrence = await tx.sessionRecurrence.create({
      data,
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.recurrence.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        // A timetable slot is not personal data, so the values are safe to
        // record and are worth recording: "why does this group have lessons on
        // a Thursday" is answered by this row.
        changedFields: {
          recurrenceId: recurrence.id,
          weekday: data.weekday,
          startMinuteOfDay: data.startMinuteOfDay,
          durationMinutes: data.durationMinutes,
          startsOn: toIsoDate(data.startsOn),
          endsOn: data.endsOn ? toIsoDate(data.endsOn) : null,
        },
      },
      tx,
    );

    return recurrence;
  });
}

/**
 * Stops a rule producing new lessons.
 *
 * DEACTIVATES, never deletes. The lessons it already produced point at it
 * through `recurrenceId`, and that pointer is half the idempotency key — delete
 * the rule and Prisma's `SetNull` orphans every session it made, so the next
 * generation run creates all of them again as duplicates. Deactivating leaves
 * the timetable exactly as it is and stops the rule at the only place it acts.
 */
export async function deactivateRecurrence(
  actor: ActorContext,
  recurrenceId: string,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const recurrence = await prisma.sessionRecurrence.findUnique({
    where: { id: recurrenceId },
    select: { groupId: true },
  });
  if (!recurrence) return;

  await requirePermission(
    actor.principal,
    "planning.manage",
    { group: recurrence.groupId },
    { at },
  );

  await prisma.$transaction(async (tx) => {
    await tx.sessionRecurrence.update({
      where: { id: recurrenceId },
      data: { active: false },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.recurrence.deactivated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: recurrence.groupId,
        requestId: actor.requestId ?? null,
        changedFields: { recurrenceId, fields: "active" },
      },
      tx,
    );
  });
}

export interface CreateClosureInput {
  /** Null or absent means CLUB-WIDE, which is the ordinary case. */
  groupId?: unknown;
  fromDate: unknown;
  toDate: unknown;
  reason: unknown;
}

/**
 * Records a closure — a school holiday, a maintenance week, one group's night
 * off.
 *
 * **IT SUPPRESSES GENERATION AND DELETES NOTHING.** Adding a holiday after a
 * term has been generated leaves those lessons exactly where they are; taking
 * them off the timetable means cancelling them, one at a time, each with its own
 * reason. A closure that reached back and deleted rows would take the attendance
 * registered against them with it, and would do so silently.
 *
 * A CLUB-WIDE closure is guarded at `{ organization: true }` and a per-group one
 * at `{ group }`, because they are genuinely different powers: shutting the club
 * for a fortnight is not something a `GROUP`-scoped principal should be able to
 * do from a screen about their own group.
 */
export async function createClosure(
  actor: ActorContext,
  input: CreateClosureInput,
): Promise<{ id: string }> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const groupId = optionalText("groupId", input.groupId, 40);

  await requirePermission(
    actor.principal,
    "planning.manage",
    groupId === null ? { organization: true } : { group: groupId },
    { at },
  );

  const fromDate = requiredDate("fromDate", input.fromDate);
  const toDate = requiredDate("toDate", input.toDate);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  return prisma.$transaction(async (tx) => {
    const closure = await tx.scheduleException.create({
      data: { groupId, fromDate, toDate, reason },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.closure.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: groupId === null ? "organization" : "group",
        targetId: groupId ?? "organization",
        requestId: actor.requestId ?? null,
        changedFields: {
          closureId: closure.id,
          clubWide: groupId === null,
          fromDate: toIsoDate(fromDate),
          toDate: toIsoDate(toDate),
        },
      },
      tx,
    );

    return closure;
  });
}

export interface RecurrenceView {
  readonly id: string;
  readonly weekday: number;
  readonly startMinuteOfDay: number;
  readonly durationMinutes: number;
  readonly startsOn: Date;
  readonly endsOn: Date | null;
  readonly active: boolean;
  readonly poolName: string | null;
}

/** A group's rules. Guarded on the group, like everything else about it. */
export async function listRecurrencesForGroup(
  actor: ActorContext,
  groupId: string,
): Promise<RecurrenceView[]> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.read",
    { group: groupId },
    { at },
  );

  const rows = await prisma.sessionRecurrence.findMany({
    where: { groupId },
    orderBy: [
      { active: "desc" },
      { weekday: "asc" },
      { startMinuteOfDay: "asc" },
    ],
    select: {
      id: true,
      weekday: true,
      startMinuteOfDay: true,
      durationMinutes: true,
      startsOn: true,
      endsOn: true,
      active: true,
      pool: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    startMinuteOfDay: row.startMinuteOfDay,
    durationMinutes: row.durationMinutes,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    active: row.active,
    poolName: row.pool?.name ?? null,
  }));
}

export interface ClosureView {
  readonly id: string;
  readonly groupId: string | null;
  readonly fromDate: Date;
  readonly toDate: Date;
  readonly reason: string;
}

/**
 * Every closure that could affect this group — club-wide and its own.
 *
 * UNGUARDED BY REACH and guarded by permission on the group: a closure carries
 * no personal data at all. It is a date range and a reason like
 * *"kerstvakantie"*, and hiding the club's holiday calendar from an instructor
 * would make the gaps in their own timetable unexplainable.
 */
export async function listClosuresForGroup(
  actor: ActorContext,
  groupId: string,
): Promise<ClosureView[]> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.read",
    { group: groupId },
    { at },
  );

  return prisma.scheduleException.findMany({
    where: { OR: [{ groupId: null }, { groupId }] },
    orderBy: [{ fromDate: "asc" }],
    select: {
      id: true,
      groupId: true,
      fromDate: true,
      toDate: true,
      reason: true,
    },
  });
}
