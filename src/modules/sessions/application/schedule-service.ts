/**
 * Generating a term's lessons, and cancelling one of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GENERATION IS IDEMPOTENT BY CONSTRUCTION, NOT BY A CHECK
 *
 * `ScheduledSession` carries a unique index on `(recurrenceId, occursOn)`. So
 * "have I already generated this lesson?" is not a question this service asks
 * and could get wrong — it is a constraint the database answers, and the write
 * is a `createMany({ skipDuplicates: true })`. Running the generator twice
 * inserts nothing the second time.
 *
 * **AND IT NEVER RESURRECTS A CANCELLED LESSON.** The constraint sees a
 * `CANCELLED` row exactly as it sees a `SCHEDULED` one, so a club that called
 * off the lesson of 12 March and then regenerated the term does not get it back.
 * That is the behaviour anyone would want and the one an "insert what is
 * missing" implementation gets wrong, because a cancelled lesson looks missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT GENERATION DOES **NOT** DO
 *
 * It does not touch a roster. §3.2 makes the roster *"derived from the group
 * plus any explicitly added guests"*, and deriving it is what keeps it correct:
 * a term generated in September would otherwise miss every child who joins in
 * November. `findSessionDetail` computes it at read time, against the lesson's
 * own date.
 *
 * It does not delete anything, ever. A closure added after a term is generated
 * suppresses future GENERATION and leaves the existing lessons alone; taking
 * them off the timetable is cancelling them, one at a time, with a reason — a
 * different act with a different record. A closure that silently deleted rows
 * would take any attendance registered against them with it.
 *
 * SERVER-ONLY.
 */
import {
  PermissionDeniedError,
  requirePermission,
  resolveReach,
  type Principal,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { getConfiguredLocalization } from "@/lib/settings";
import { requiredDate, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  expandAll,
  type ClosureWindow,
  type RecurrenceRule,
} from "../domain/recurrence";
import {
  resolveTimeZone,
  toIsoDate,
  wallClockToInstant,
} from "../domain/zoned-time";
import { ensureSessionsRegistrations } from "../infrastructure/registrations";
import {
  findSessionDetail,
  listSessions,
  ReachCoversNoSessionError,
  type ScheduledSessionListItem,
  type SessionDetail,
} from "../infrastructure/session-repository";
import { MAX_GENERATION_DAYS, TEXT_MAX } from "./input";

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export class ScheduleError extends Error {
  constructor(
    public readonly reason:
      "windowTooWide" | "windowOrder" | "alreadyCancelled" | "notFound",
    message: string,
  ) {
    super(message);
    this.name = "ScheduleError";
  }
}

export interface GenerateSessionsInput {
  from: unknown;
  to: unknown;
}

export interface GenerationReport {
  readonly groupId: string;
  /** The zone the wall-clock times were resolved in. Reported, not assumed. */
  readonly timeZone: string;
  readonly planned: number;
  /** Rows actually inserted. On a second run this is 0 — that is idempotency. */
  readonly created: number;
  /** Dates a rule wanted and a closure took, with the closure's reason. */
  readonly skipped: readonly { date: string; reason: string }[];
}

/**
 * Generates a group's lessons for a window from its recurrences.
 *
 * `planning.manage` and not a `sessions.*` key, deliberately. §2.5's catalogue
 * has no permission for scheduled sessions — its `sessions.read` and
 * `sessions.revoke` are LOGIN sessions, in the `identity` group — and §2.5's own
 * rule is that a permission referenced anywhere and absent from the catalogue is
 * a defect rather than a shorthand. Inventing `sessions.manage` here would put
 * the catalogue's second home in this module. `planning.manage` is the
 * catalogued permission for the act of planning, which is exactly this.
 * Recorded in the phase 1.6 report.
 */
export async function generateSessions(
  actor: ActorContext,
  groupId: string,
  input: GenerateSessionsInput,
): Promise<GenerationReport> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { group: groupId },
    { at },
  );

  const from = requiredDate("from", input.from);
  const to = requiredDate("to", input.to);
  if (to.getTime() < from.getTime()) {
    throw new ScheduleError(
      "windowOrder",
      "The end of the window falls before its start, so it contains no dates.",
    );
  }
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_GENERATION_DAYS) {
    throw new ScheduleError(
      "windowTooWide",
      `Generate at most ${MAX_GENERATION_DAYS} days at a time. A wider ` +
        "window is almost always a mistyped year, and running this twice is " +
        "safe — it inserts nothing the second time.",
    );
  }

  const timeZone = resolveTimeZone(
    (await getConfiguredLocalization()).timeZone,
  );

  const [rules, closures] = await Promise.all([
    prisma.sessionRecurrence.findMany({
      where: { groupId, active: true },
      select: {
        id: true,
        weekday: true,
        startMinuteOfDay: true,
        durationMinutes: true,
        startsOn: true,
        endsOn: true,
        active: true,
        poolId: true,
      },
    }),
    // Club-wide closures AND this group's own, in one read. The expander does
    // the narrowing, so the rule about which applies lives in one place.
    prisma.scheduleException.findMany({
      where: { OR: [{ groupId: null }, { groupId }] },
      select: { groupId: true, fromDate: true, toDate: true, reason: true },
    }),
  ]);

  const poolByRecurrence = new Map(
    rules.map((rule) => [rule.id, rule.poolId] as const),
  );

  const { planned, skipped } = expandAll(
    rules as RecurrenceRule[],
    from,
    to,
    closures as ClosureWindow[],
    groupId,
  );

  const rows = planned.map((occurrence) => {
    const date = occurrence.occursOn;
    const startsAt = wallClockToInstant(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      occurrence.startMinuteOfDay,
      timeZone,
    );
    return {
      groupId,
      poolId: poolByRecurrence.get(occurrence.recurrenceId) ?? null,
      recurrenceId: occurrence.recurrenceId,
      occursOn: date,
      startsAt,
      // Added to the INSTANT, not to the wall clock. A 45-minute lesson is 45
      // minutes long even on the night the clocks go back; computing the end as
      // a second wall-clock time would make it 105.
      endsAt: new Date(
        startsAt.getTime() + occurrence.durationMinutes * 60_000,
      ),
    };
  });

  const created = await prisma.$transaction(async (tx) => {
    // THE IDEMPOTENCY. `skipDuplicates` against the unique index on
    // `(recurrenceId, occursOn)` — the database decides what already exists, so
    // there is no read-then-write window and no cancelled lesson to resurrect.
    const result = await tx.scheduledSession.createMany({
      data: rows,
      skipDuplicates: true,
    });

    await recordAuditEvent(
      {
        eventType: "sessions.schedule.generated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        // ONE EVENT PER GENERATION, not one per lesson. §4.1's rule 8: audit
        // appends serialize on a Postgres advisory lock, so two hundred chained
        // rows for one action would contend globally against every other audit
        // writer.
        changedFields: {
          from: toIsoDate(from),
          to: toIsoDate(to),
          timeZone,
          rules: rules.length,
          planned: planned.length,
          created: result.count,
          skipped: skipped.length,
        },
      },
      tx,
    );

    return result.count;
  });

  return {
    groupId,
    timeZone,
    planned: planned.length,
    created,
    skipped: skipped.map((entry) => ({
      date: toIsoDate(entry.occursOn),
      reason: entry.reason,
    })),
  };
}

export interface CancelSessionInput {
  reason: unknown;
}

/**
 * Cancels one lesson. **The row stays.**
 *
 * A parent asking why their child missed a week deserves *"de les van 12 maart
 * is afgelast — bad in onderhoud"*, and a deleted row answers *"there was no
 * lesson"*, which is a different and untrue thing. Deleting would also take any
 * attendance registered against it, and re-running generation would put the
 * lesson back.
 *
 * The reason is mandatory here and at the database
 * (`ScheduledSession_cancellation_shape_check`), on the same reasoning D-108
 * gives for a group move: the explanation is the value of the record.
 */
export async function cancelSession(
  actor: ActorContext,
  sessionId: string,
  input: CancelSessionInput,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { session: sessionId },
    { at },
  );

  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  await prisma.$transaction(async (tx) => {
    const session = await tx.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { id: true, status: true, groupId: true },
    });
    if (!session) {
      throw new ScheduleError("notFound", "That lesson does not exist.");
    }
    if (session.status === "CANCELLED") {
      throw new ScheduleError(
        "alreadyCancelled",
        "That lesson is already cancelled. Cancelling it again would " +
          "overwrite the reason somebody already recorded.",
      );
    }

    await tx.scheduledSession.update({
      where: { id: sessionId },
      data: {
        status: "CANCELLED",
        cancelledAt: at,
        cancellationReason: reason,
      },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.session.cancelled",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          groupId: session.groupId,
          fields: "status,cancelledAt,cancellationReason",
        },
      },
      tx,
    );
  });
}

/**
 * A group's schedule for a window.
 *
 * A DENIAL when the reach covers no session, never an empty week — the case
 * `06-delivery.md` §2.1 names.
 */
export async function listSessionsForPrincipal(
  actor: ActorContext,
  window: { from: Date; to: Date; groupId?: string },
): Promise<ScheduledSessionListItem[]> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const reach = await resolveReach(actor.principal, "planning.read", { at });

  try {
    return await listSessions(reach, at, window);
  } catch (error) {
    if (error instanceof ReachCoversNoSessionError) {
      throw new PermissionDeniedError("planning.read", "session list");
    }
    throw error;
  }
}

/**
 * One lesson and its effective roster.
 *
 * Guarded on `{ session }`, which is what makes a make-up guest's instructor
 * able to open it: a `SESSION`-scoped grant covers that one session inside its
 * window (D-068) and nothing else. A `GROUP`-scoped instructor reaches it
 * through `groupOfSession`, and an administrator through `ORGANIZATION`.
 */
export async function getSessionForPrincipal(
  actor: ActorContext,
  sessionId: string,
): Promise<SessionDetail | null> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.read",
    { session: sessionId },
    { at },
  );

  return findSessionDetail(sessionId);
}
