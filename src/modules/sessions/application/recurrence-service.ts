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
import { getConfiguredLocalization } from "@/lib/settings";
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
import { closureCovering, type ClosureWindow } from "../domain/recurrence";
import {
  addDays,
  isoWeekday,
  resolveTimeZone,
  toIsoDate,
  wallClockToInstant,
} from "../domain/zoned-time";
import { TEXT_MAX } from "./input";
import { pinPastOccurrences } from "./lane-assignment-service";
import { ScheduleError, type ActorContext } from "./schedule-service";

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

export interface UpdateRecurrenceInput {
  poolId?: unknown;
  weekday: unknown;
  startTime: unknown;
  durationMinutes: unknown;
}

export interface RecurrenceUpdateReport {
  /** Which fields actually differ. Empty means nothing was written. */
  readonly changed: readonly string[];
  /** Future lessons rewritten to match the rule. */
  readonly moved: number;
  /** Of those, how many now fall on a closed date. Reported, not resolved. */
  readonly onClosure: number;
  /** Past lessons frozen at their inherited lanes, because the pool moved. */
  readonly pinnedSessions: number;
  /** The rule's new `startsOn` when a weekday change carried it forward. */
  readonly startsOn: string | null;
}

/**
 * Corrects a season's weekday, its time, its length or its pool — and brings
 * the lessons it has already produced along.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, WHEN PHASE 1.7 CLOSED THE SAME QUESTION WITH "STOP AND
 * CREATE"
 *
 * D-6 recorded a rule typed with the wrong weekday as already answered:
 * deactivate it, make another. **That answer does not survive contact with the
 * idempotency key.** `deactivateRecurrence` sets `active: false` and touches no
 * `ScheduledSession` at all — deliberately, because the rows it produced point
 * at it. So every lesson the wrong rule already generated stays on the
 * timetable, and the replacement rule generates its own beside them: the
 * unique index is `(recurrenceId, occursOn)`, per RULE, so a second series on
 * the same evening does not deduplicate against the first. The club is left
 * with two lessons that night, one of them at the wrong time, both real.
 *
 * Correcting the rule in place has no such gap: there is one series, it keeps
 * its id, and its occurrences keep theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENS TO THE LESSONS — D-190'S RULES, NOT A SECOND SET
 *
 * Phase 1.8 answered this for lanes and the answer is a property of the
 * schedule, not of lanes: a timetable is read backwards as the club's own
 * record of what it did. Applied here:
 *
 *   1. **A lesson that has already started never moves.** `startsAt <= now`,
 *      the same boundary D-190 draws and for the same reason — *"waar en
 *      wanneer zwommen we op 12 maart"* has one true answer and it is not
 *      "wherever the rule says today".
 *
 *      This half is FREE, and it is free in the mirror image of lanes. A lesson
 *      stores its own `startsAt`, `endsAt`, `occursOn` and `poolId` — they were
 *      copied at generation — so the past is frozen by not being written. Lanes
 *      are inherited by REFERENCE, which is why there the past is what costs and
 *      the future is free. Same decision, opposite arithmetic.
 *
 *   2. **A future lesson follows.** *"Vanaf nu beginnen we om half zeven"* is
 *      what a person means, and it is the whole point of correcting a rule
 *      rather than editing thirty rows.
 *
 *   3. **A deliberate deviation is never reverted.** Today no deviation of TIME
 *      or POOL can exist: nothing in this application changes one lesson's
 *      `startsAt` or `poolId`, so every future occurrence still follows its
 *      rule by construction and rule 3 has nothing to exclude. It is stated
 *      anyway because the day a per-lesson reschedule is built, it must carry a
 *      marker the way `laneSource` does and this propagation must skip it.
 *      Inventing that column now would be a model ahead of its screen, which is
 *      the defect `service-reachability.test.ts` exists for.
 *
 *   4. **A cancelled lesson stays cancelled.** `status`, `cancelledAt` and
 *      `cancellationReason` are not in any write below, so a cancellation
 *      cannot be undone by a correction — which is what a *"the lesson moved to
 *      18:30"* edit would otherwise quietly do.
 *
 *      A future cancelled lesson MOVES, and stays cancelled. Leaving it behind
 *      would be worse than it sounds: the moved series would generate a fresh
 *      SCHEDULED lesson that week beside the abandoned cancelled one, and the
 *      week the club called off would silently reopen. Status is not part of
 *      the boundary — the same sentence D-190 uses to keep this to one rule.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WEEKDAY, AND WHY `startsOn` MOVES WITH IT
 *
 * Moving Tuesday to Thursday shifts every future occurrence FORWARD by
 * `(new - old + 7) % 7` days — forward always, never back, so no correction can
 * drop a lesson into a past it did not happen in. Every row shifts by the same
 * constant, so the seven-day spacing is preserved and no moved date can collide
 * with another of this rule's dates; they are written newest-first regardless,
 * so no intermediate state of the transaction can either.
 *
 * `startsOn` is then carried forward to the first moved occurrence, and that is
 * NOT a tidy-up — it is what keeps generation idempotent. A rule that still
 * claimed to start in September while its September lessons sat on the old
 * weekday would, on the next generation run over a past window, produce a
 * second set of lessons for every week the club has already taught. The rule
 * describes what it plans from here; the lessons behind it are the record of
 * what it planned before, and they keep pointing at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE POOL, AND THE ONE REFUSAL THIS SERVICE MAKES
 *
 * A lane is a place inside a pool, so moving a season to another pool empties
 * its lane selection — the same loss `setRecurrenceLanes([])` is, and it owes
 * the past the same freeze, so it calls `pinPastOccurrences` rather than
 * repeating rule 3 in a second place.
 *
 * It REFUSES when a future lesson carries lanes of its own. Those lanes are in
 * the pool being left behind, and there are only bad answers: silently clearing
 * the override is the reversion D-190 exists to forbid, and keeping it leaves a
 * lesson claiming to swim in water it is not in. So the person is told, and the
 * way out is the one already on that lesson's page — *"weer de lesreeks
 * volgen"*.
 */
export async function updateRecurrence(
  actor: ActorContext,
  recurrenceId: string,
  input: UpdateRecurrenceInput,
): Promise<RecurrenceUpdateReport> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const before = await prisma.sessionRecurrence.findUnique({
    where: { id: recurrenceId },
    select: {
      groupId: true,
      poolId: true,
      weekday: true,
      startMinuteOfDay: true,
      durationMinutes: true,
      startsOn: true,
      endsOn: true,
    },
  });
  if (!before) {
    throw new ScheduleError("notFound", "That lesson series does not exist.");
  }

  // Guarded on the series' OWN group, read from the row — `setRecurrenceLanes`
  // makes the same read for the same reason.
  await requirePermission(
    actor.principal,
    "planning.manage",
    { group: before.groupId },
    { at },
  );

  const weekday = requiredInt("weekday", input.weekday, 1, 7);
  const startMinuteOfDay = requiredTimeOfDay("startTime", input.startTime);
  const durationMinutes = requiredInt(
    "durationMinutes",
    input.durationMinutes,
    1,
    1440,
  );
  const poolId = optionalText("poolId", input.poolId, 40);

  const changed: string[] = [];
  if (before.weekday !== weekday) changed.push("weekday");
  if (before.startMinuteOfDay !== startMinuteOfDay) {
    changed.push("startMinuteOfDay");
  }
  if (before.durationMinutes !== durationMinutes) changed.push("duration");
  const poolMoved = before.poolId !== poolId;
  if (poolMoved) changed.push("poolId");

  // NOTHING WRITTEN WHEN NOTHING CHANGED. Pressing save on an untouched form
  // would otherwise rewrite a season's worth of lessons, freeze its past and
  // append an audit event saying something happened. `updateClosure` and
  // `setRecurrenceLanes` make the same refusal.
  if (changed.length === 0) {
    return {
      changed: [],
      moved: 0,
      onClosure: 0,
      pinnedSessions: 0,
      startsOn: null,
    };
  }

  const timeZone = resolveTimeZone(
    (await getConfiguredLocalization()).timeZone,
  );
  // Forward always. `(new - old + 7) % 7` is 0..6, so a moved lesson lands
  // inside the week it belonged to and never before it.
  const shift = (weekday - before.weekday + 7) % 7;

  return prisma.$transaction(async (tx) => {
    if (poolMoved && poolId !== null) {
      // Read the pool rather than trust the form and let the foreign key
      // decide: a bad id would otherwise be a 500 where a sentence belongs.
      // INACTIVE IS ALSO A REFUSAL — a pool taken out of service is not a
      // place to plan lessons, which is why the create form does not offer it.
      const pool = await tx.pool.findUnique({
        where: { id: poolId },
        select: { active: true },
      });
      if (!pool?.active) {
        throw new ScheduleError(
          "poolNotFound",
          "That pool does not exist, or has been taken out of use.",
        );
      }
    }

    // Newest first — see the header: the write order cannot violate
    // `(recurrenceId, occursOn)` even transiently.
    const future = await tx.scheduledSession.findMany({
      where: { recurrenceId, startsAt: { gt: at } },
      orderBy: { occursOn: "desc" },
      select: { id: true, occursOn: true, laneSource: true },
    });

    if (poolMoved) {
      const ownLanes = future.filter((row) => row.laneSource !== null).length;
      if (ownLanes > 0) {
        throw new ScheduleError(
          "laneOverrideBlocksPool",
          `${ownLanes} future lesson(s) have lanes of their own in the ` +
            "current pool. Return them to following the series first.",
        );
      }
    }

    let pinnedSessions = 0;
    if (poolMoved) {
      const had = await tx.recurrenceLane.findMany({
        where: { recurrenceId },
        select: { laneId: true },
      });
      // Only when there is something to lose. A season with no lanes recorded
      // loses nothing by moving pool, and pinning its past would freeze it to
      // say the application had decided something it had not.
      if (had.length > 0) {
        pinnedSessions = await pinPastOccurrences(
          tx,
          recurrenceId,
          had.map((row) => row.laneId),
          at,
        );
        await tx.recurrenceLane.deleteMany({ where: { recurrenceId } });
      }
    }

    // Only a weekday change can walk a lesson onto a closed date, so the
    // closure calendar is only read when one happened.
    const closures: ClosureWindow[] =
      shift === 0 || future.length === 0
        ? []
        : await tx.scheduleException.findMany({
            where: { OR: [{ groupId: null }, { groupId: before.groupId }] },
            select: {
              groupId: true,
              fromDate: true,
              toDate: true,
              reason: true,
            },
          });

    let onClosure = 0;
    for (const lesson of future) {
      const occursOn =
        shift === 0 ? lesson.occursOn : addDays(lesson.occursOn, shift);
      // The wall clock, resolved on the lesson's OWN date — the generator's
      // rule, and the reason a term spanning the March changeover is not an
      // hour out for half of itself.
      const startsAt = wallClockToInstant(
        occursOn.getUTCFullYear(),
        occursOn.getUTCMonth() + 1,
        occursOn.getUTCDate(),
        startMinuteOfDay,
        timeZone,
      );
      await tx.scheduledSession.update({
        where: { id: lesson.id },
        data: {
          occursOn,
          startsAt,
          // Added to the INSTANT, as at generation: 45 minutes is 45 minutes
          // even on the night the clocks go back.
          endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000),
          ...(poolMoved ? { poolId } : {}),
        },
      });
      if (shift !== 0 && closureCovering(closures, before.groupId, occursOn)) {
        onClosure += 1;
      }
    }

    let startsOn = before.startsOn;
    if (shift !== 0) {
      const anchor = await nextPlannedDate(tx, {
        recurrenceId,
        weekday,
        shift,
        future,
      });
      if (anchor !== null && anchor.getTime() > startsOn.getTime()) {
        startsOn = anchor;
        changed.push("startsOn");
      }
    }

    await tx.sessionRecurrence.update({
      where: { id: recurrenceId },
      data: {
        weekday,
        startMinuteOfDay,
        durationMinutes,
        poolId,
        startsOn,
      },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.recurrence.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: before.groupId,
        requestId: actor.requestId ?? null,
        // The VALUES, as `createRecurrence` records them — a timetable slot is
        // not personal data, and "why does this group swim on Thursday now" is
        // answered by this row. The counts are the part that is otherwise
        // invisible: how many lessons one edit rewrote.
        changedFields: {
          recurrenceId,
          fields: changed.join(","),
          weekday,
          startMinuteOfDay,
          durationMinutes,
          poolId,
          startsOn: toIsoDate(startsOn),
          movedSessions: future.length,
          onClosure,
          pinnedSessions,
        },
      },
      tx,
    );

    return {
      changed,
      moved: future.length,
      onClosure,
      pinnedSessions,
      startsOn: startsOn === before.startsOn ? null : toIsoDate(startsOn),
    };
  });
}

/**
 * Where the rule should claim to start, once its weekday has moved.
 *
 * The first occurrence it still owns: the earliest lesson that just moved, or —
 * when every lesson it made is already in the past — the first date of the new
 * weekday after the last of them. Either way the rule stops planning the weeks
 * behind it, which is what keeps a regeneration over an old window from
 * producing a second lesson for every week the club has already taught.
 *
 * Returns null when the rule has produced nothing at all: there is no history
 * to step over, so its `startsOn` still means what it said.
 */
async function nextPlannedDate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    recurrenceId: string;
    weekday: number;
    shift: number;
    /** This rule's future lessons, newest first. */
    future: readonly { occursOn: Date }[];
  },
): Promise<Date | null> {
  const earliestMoved = args.future.at(-1);
  if (earliestMoved) return addDays(earliestMoved.occursOn, args.shift);

  const lastTaught = await tx.scheduledSession.findFirst({
    where: { recurrenceId: args.recurrenceId },
    orderBy: { occursOn: "desc" },
    select: { occursOn: true },
  });
  if (!lastTaught) return null;

  const dayAfter = addDays(lastTaught.occursOn, 1);
  return addDays(dayAfter, (args.weekday - isoWeekday(dayAfter) + 7) % 7);
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

export interface UpdateClosureInput {
  fromDate: unknown;
  toDate: unknown;
  reason: unknown;
}

/**
 * Corrects a closure's dates or its reason.
 *
 * A CLOSURE IS CONFIGURATION AND NOT HISTORY, which is what makes an in-place
 * update the right shape (see `facility-service.ts` for the same argument about
 * a pool's name). *"Kerstvakantie, 21-12 t/m 5-1"* typed as *"21-11"* is a
 * fortnight of lessons the generator will silently not produce, and the wrong
 * dates answer no question anybody will ask.
 *
 * IT CHANGES ONLY WHAT WILL BE GENERATED. Widening a closure does not remove
 * lessons that already exist — cancelling does that, one at a time and each
 * with a reason — and narrowing one does not create them: generation is a
 * separate act an administrator triggers, and it is idempotent, so re-running
 * it fills the gap the correction opened.
 *
 * THE SCOPE IS NOT EDITABLE. Turning a club-wide closure into one group's night
 * off, or the reverse, crosses the boundary `createClosure` guards — shutting
 * the club for a fortnight is not a power a `GROUP`-scoped principal holds — so
 * that is a new closure rather than a field on this one.
 */
export async function updateClosure(
  actor: ActorContext,
  closureId: string,
  input: UpdateClosureInput,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const before = await prisma.scheduleException.findUnique({
    where: { id: closureId },
    select: { groupId: true, fromDate: true, toDate: true, reason: true },
  });
  if (!before) return;

  // Guarded on the closure's OWN scope, read from the row. Taking the scope
  // from the caller would let a group-scoped principal aim a per-group edit at
  // a club-wide closure and be checked against their own group.
  await requirePermission(
    actor.principal,
    "planning.manage",
    before.groupId === null
      ? { organization: true }
      : { group: before.groupId },
    { at },
  );

  const fromDate = requiredDate("fromDate", input.fromDate);
  const toDate = requiredDate("toDate", input.toDate);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  if (toDate < fromDate) {
    throw new ScheduleError(
      "windowOrder",
      "A closure cannot end before it starts.",
    );
  }

  const changed: string[] = [];
  if (before.fromDate.getTime() !== fromDate.getTime()) {
    changed.push("fromDate");
  }
  if (before.toDate.getTime() !== toDate.getTime()) changed.push("toDate");
  if (before.reason !== reason) changed.push("reason");
  if (changed.length === 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.scheduleException.update({
      where: { id: closureId },
      data: { fromDate, toDate, reason },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.closure.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: before.groupId === null ? "organization" : "group",
        targetId: before.groupId ?? "organization",
        requestId: actor.requestId ?? null,
        // The dates travel as VALUES, exactly as `createClosure` records them:
        // a closed date range is a fact about a timetable rather than personal
        // data, and "why is there a hole in March" is answered by these rows.
        changedFields: {
          closureId,
          fields: changed.join(","),
          fromDate: toIsoDate(fromDate),
          toDate: toIsoDate(toDate),
        },
      },
      tx,
    );
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
  /**
   * The pool's ID as well as its name, because the screen that NAMES the pool
   * is now also the screen that changes it: a `<select>` whose current value is
   * not among its options silently selects the first one, so an edit form that
   * only knew the name would quietly clear the pool of a series whose pool has
   * been taken out of use.
   */
  readonly poolId: string | null;
  readonly poolName: string | null;
  /**
   * THE LANES THIS SEASON USES, and every lane it could use.
   *
   * Both, because the screen that shows the first is the screen that edits it,
   * and the choices have to be the lanes of THIS rule's pool — which is the
   * only place the pool is known without a second read. A rule with no pool
   * gets an empty `poolLanes` and can hold no lanes, which is what the service
   * refuses and what the form therefore must not offer.
   */
  readonly lanes: readonly { readonly id: string; readonly name: string }[];
  readonly poolLanes: readonly { readonly id: string; readonly name: string }[];
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
      poolId: true,
      pool: {
        select: {
          name: true,
          lanes: {
            orderBy: [{ sequence: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
          },
        },
      },
      lanes: {
        select: { lane: { select: { id: true, name: true, sequence: true } } },
      },
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
    poolId: row.poolId,
    poolName: row.pool?.name ?? null,
    lanes: row.lanes
      .map((entry) => entry.lane)
      .sort(
        (left, right) =>
          left.sequence - right.sequence ||
          left.name.localeCompare(right.name, "nl"),
      )
      .map((lane) => ({ id: lane.id, name: lane.name })),
    poolLanes: row.pool?.lanes ?? [],
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
