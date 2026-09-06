/**
 * Which lanes a lesson is swum in — set for the season, overridden for a week.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE CAME FROM THE DOMAIN EXPERT, NOT FROM THE SCHEMA
 *
 * `SessionLane` has been in `prisma/schema.prisma` since phase 1.6 and **no
 * code in this application has ever written a row into it**. A club could
 * record which pool a group swims in and not which lanes — which is the half of
 * the answer that matters the moment two groups share the water.
 *
 * The question of what the surface should look like went to the person who
 * teaches there:
 *
 *   > *"Vaak ligt het het seizoen vast, een enkele keer wisselt het."*
 *   > — Jack, swim instructor at the club, 2026-09-06
 *
 * So the answer is not "pick lanes per lesson" and not "pick lanes per club".
 * Lane assignment is an attribute of the SEASON — of the `SessionRecurrence`
 * the season is generated from — and one occurrence may differ. D-190.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INHERITANCE IS BY REFERENCE, WHICH IS WHY IT COSTS NOTHING PER WEEK
 *
 * A generated lesson stores NO lanes. It stores `recurrenceId`, which it has
 * carried since phase 1.6, and its lanes are read through it. Thirty-six
 * Tuesdays inherit the same three lanes by pointing at one row, not by copying
 * three rows thirty-six times, and `generateSessions` writes nothing extra.
 *
 * That is also what makes the FUTURE half of propagation free: change the
 * recurrence's lanes and every lesson that still inherits already says the new
 * answer, because it never said anything of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE STATES, AND THE ONE PLACE THEY ARE RESOLVED
 *
 *   INHERITED  `laneSource IS NULL`. Ask the recurrence. The ordinary case.
 *   OVERRIDE   A person chose these lanes for this lesson.
 *   PINNED     Nobody chose them; the application froze them — see below.
 *
 * `resolveLaneSource` below is the only function that turns a row into one of
 * those three, and the repository calls it. D-134: one home per rule.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGING A RECURRENCE'S LANES DOES — THE DECISION, ARGUED
 *
 *   1. A lesson carrying an OVERRIDE is never touched. An override is a
 *      deliberate act, and silently reverting one is the class of surprise that
 *      makes people stop trusting a schedule. This is the requirement, not a
 *      judgement call.
 *
 *   2. A FUTURE lesson that still inherits follows, for free, by construction.
 *      *"Vanaf nu zwemmen we in baan 4 en 5"* is the sentence a person means
 *      when they change a season's lanes, and a change that left next week
 *      alone would leave them editing thirty rows by hand — which is the
 *      per-week cost the inherit model exists to avoid.
 *
 *   3. A lesson that has ALREADY HAPPENED keeps the lanes it was taught in.
 *      Its lanes are copied onto it and marked `PINNED`, in the same
 *      transaction as the change.
 *
 * Rule 3 is the one that costs something, so it is the one worth arguing. Pure
 * by-reference inheritance would give it for free — and would be wrong. A
 * schedule is not only a plan; it is read backwards, as the club's own record of
 * what it did. *"Waar zwommen we op 12 maart?"* is a question with one true
 * answer, and it is not "wherever the rule happens to say today". Attendance
 * will hang off these same rows in a later phase, and an instructor looking back
 * at a lesson must see the water that lesson was in.
 *
 * The cost is paid ONCE, at the moment somebody changes a season's lanes, and is
 * proportional to the lessons already taught — not per week, which is the budget
 * that mattered. A season is a few dozen rows and one audit event.
 *
 * `PINNED` is a distinct value from `OVERRIDE` for a reason that is entirely
 * about the reader: a pinned lesson renders as *"vastgelegd"* and not as
 * *"afwijkend"*, because telling somebody they deliberately changed fourteen
 * past lessons they never touched is a lie the schedule would be telling them
 * every time they opened it.
 *
 * The boundary is `startsAt <= now`, and nothing else — not the status. A
 * cancelled lesson is in the past or it is not, on the same clock as every other
 * one; making cancellation part of the rule would mean two rules to explain and
 * a lesson whose lanes change when somebody calls it off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LANES BELONG TO A POOL, AND THE SERVICE IS WHERE THAT IS HELD
 *
 * A lesson in the instruction pool cannot occupy a lane in the competition
 * pool. The foreign key cannot say so — a lane's pool is one join away from a
 * recurrence — so every write here reads the target's own `poolId` from the row
 * and refuses a lane that is not in it. A recurrence with no pool can hold no
 * lanes at all, because a lane with no pool is not a place.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

import { ensureSessionsRegistrations } from "../infrastructure/registrations";
import { LANE_SELECTION_MAX } from "./input";
import { ScheduleError, type ActorContext } from "./schedule-service";

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

/**
 * Where a lesson's lanes come from, as a screen reads it.
 *
 * `INHERITED` is the collapsed form of `laneSource IS NULL`, so no surface has
 * to know that the ordinary case is stored as an absence.
 */
export type SessionLaneSourceView = "INHERITED" | "OVERRIDE" | "PINNED";

/** THE one place a stored `laneSource` becomes something a surface renders. */
export function resolveLaneSource(
  stored: "OVERRIDE" | "PINNED" | null,
): SessionLaneSourceView {
  return stored ?? "INHERITED";
}

/**
 * The lane ids a form submitted, deduplicated and bounded.
 *
 * `FormData.getAll` gives an array of strings for repeated checkboxes and a
 * single value is not an array, so both shapes are accepted. Nothing here
 * checks that the ids EXIST or belong anywhere — that is done against the
 * target's own pool, below, where the pool is known.
 */
function laneIdList(value: unknown): string[] {
  const raw = value == null ? [] : Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new ScheduleError("laneUnknown", "A lane id must be text.");
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    // Deduplicated rather than refused: two checkboxes with the same value is a
    // markup accident, and `SessionLane`'s composite key would reject the
    // second insert as a duplicate-key 500 rather than as anything a person
    // could act on.
    if (!ids.includes(trimmed)) ids.push(trimmed);
  }
  if (ids.length > LANE_SELECTION_MAX) {
    throw new ScheduleError(
      "laneUnknown",
      `A lesson cannot use more than ${LANE_SELECTION_MAX} lanes.`,
    );
  }
  return ids;
}

/**
 * Refuses any lane that is not in `poolId`, and any lane at all when there is
 * no pool.
 *
 * READS THE POOL FROM THE ROW, never from the caller — the same rule
 * `updateLane` and `updateClosure` follow. A `poolId` travelling on the form
 * would be a field an attacker could change to put somebody else's lanes on a
 * lesson, and it would buy one query.
 */
async function lanesInPool(
  tx: Pick<typeof prisma, "lane">,
  poolId: string | null,
  laneIds: readonly string[],
): Promise<void> {
  if (laneIds.length === 0) return;
  if (poolId === null) {
    throw new ScheduleError(
      "laneWithoutPool",
      "Choose a pool before choosing lanes: a lane is a place inside one.",
    );
  }
  const found = await tx.lane.findMany({
    where: { id: { in: [...laneIds] }, poolId },
    select: { id: true },
  });
  if (found.length !== laneIds.length) {
    // ONE refusal for "does not exist" and "is in another pool" together. They
    // are the same thing from the caller's side — a lane they may not put here
    // — and separating them would answer "does lane X exist" for anybody who
    // can reach the endpoint.
    throw new ScheduleError(
      "laneNotInPool",
      "One of those lanes is not in this lesson's pool.",
    );
  }
}

export interface SetRecurrenceLanesInput {
  /** Zero or more lane ids. An empty selection means "no lanes recorded". */
  laneIds: unknown;
}

/**
 * Sets which lanes a season's lessons use.
 *
 * A REPLACEMENT AND NOT AN ADDITION: the submitted set is what the recurrence
 * uses afterwards, because the surface is a set of checkboxes and a person
 * unticking one means *"not that lane any more"*. Submitting none is legitimate
 * and means the club has not recorded lanes for this rule.
 *
 * The propagation rules are in the file header, and each of the three is
 * visible in the code below: overrides are excluded by `laneSource: null`, past
 * lessons are pinned before the change lands, and future ones need no statement
 * at all because they never stored anything.
 */
export async function setRecurrenceLanes(
  actor: ActorContext,
  recurrenceId: string,
  input: SetRecurrenceLanesInput,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  const recurrence = await prisma.sessionRecurrence.findUnique({
    where: { id: recurrenceId },
    select: { groupId: true, poolId: true },
  });
  if (!recurrence) {
    throw new ScheduleError("notFound", "That lesson series does not exist.");
  }

  // Guarded on the recurrence's OWN group, read from the row.
  await requirePermission(
    actor.principal,
    "planning.manage",
    { group: recurrence.groupId },
    { at },
  );

  const laneIds = laneIdList(input.laneIds);

  await prisma.$transaction(async (tx) => {
    await lanesInPool(tx, recurrence.poolId, laneIds);

    const before = await tx.recurrenceLane.findMany({
      where: { recurrenceId },
      select: { laneId: true },
    });
    const had = new Set(before.map((row) => row.laneId));
    const wants = new Set(laneIds);
    const unchanged =
      had.size === wants.size && [...had].every((id) => wants.has(id));
    // Nothing written when nothing changed — including the pinning, which would
    // otherwise freeze the whole past of a season every time somebody opened
    // the form and pressed save. `updatePool` makes the same refusal for the
    // same reason: a trail with entries for non-events is one nobody reads.
    if (unchanged) return;

    // ── rule 3, and it happens BEFORE the change ────────────────────────────
    // The lanes being frozen are the ones the recurrence has *now*, so the copy
    // has to be taken while `before` is still true of the database.
    const pinned = await pinPastOccurrences(tx, recurrenceId, [...had], at);

    await tx.recurrenceLane.deleteMany({ where: { recurrenceId } });
    if (laneIds.length > 0) {
      await tx.recurrenceLane.createMany({
        data: laneIds.map((laneId) => ({ recurrenceId, laneId })),
      });
    }

    await recordAuditEvent(
      {
        eventType: "sessions.recurrence.lanes.set",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: recurrence.groupId,
        requestId: actor.requestId ?? null,
        // COUNTS, not lane ids. Which lane a group swims in is not personal
        // data, but the trail's job here is "somebody changed the season's
        // lanes and froze this many past lessons" — the ids answer nothing an
        // auditor asks, and `pinnedSessions` answers the one thing that is
        // otherwise invisible: how much of the past this write touched.
        changedFields: {
          recurrenceId,
          lanes: laneIds.length,
          previousLanes: had.size,
          pinnedSessions: pinned,
        },
      },
      tx,
    );
  });
}

/**
 * Freezes the lanes of every already-started lesson that still inherits.
 *
 * Returns how many it froze. `laneSource: null` is the whole of "still
 * inherits", which is why the marker column exists: an override and a pinned
 * lesson are both excluded by it, and neither could be excluded by looking at
 * whether `SessionLane` rows are present, because an override with no lanes
 * looks exactly like an inheriting lesson from the join table alone.
 */
async function pinPastOccurrences(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  recurrenceId: string,
  laneIds: readonly string[],
  at: Date,
): Promise<number> {
  const past = await tx.scheduledSession.findMany({
    where: { recurrenceId, laneSource: null, startsAt: { lte: at } },
    select: { id: true },
  });
  if (past.length === 0) return 0;

  // The marker first, then the rows. A lesson that carried lanes while still
  // claiming to inherit would be answering the same question twice, and the
  // window between the two statements is inside this transaction.
  await tx.scheduledSession.updateMany({
    where: { id: { in: past.map((row) => row.id) } },
    data: { laneSource: "PINNED" },
  });
  if (laneIds.length > 0) {
    await tx.sessionLane.createMany({
      data: past.flatMap((row) =>
        laneIds.map((laneId) => ({ sessionId: row.id, laneId })),
      ),
    });
  }
  return past.length;
}

export interface OverrideSessionLanesInput {
  laneIds: unknown;
}

/**
 * Gives ONE lesson its own lanes. *"Een enkele keer wisselt het."*
 *
 * IT TOUCHES NOTHING ELSE — not the recurrence, not the lesson beside it. The
 * write is scoped to one `ScheduledSession` id and the only rows it creates
 * carry that id, which is what makes "override one occurrence" a statement
 * about one occurrence.
 *
 * An override with an EMPTY selection is legitimate and is not the same as
 * clearing it: *"deze week geen vaste baan"* is a decision, and it survives a
 * later change to the season's lanes exactly as any other override does.
 * `clearSessionLaneOverride` is the way back to inheriting.
 */
export async function overrideSessionLanes(
  actor: ActorContext,
  sessionId: string,
  input: OverrideSessionLanesInput,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  // `{ session }`, like every other write about one lesson: a SESSION-scoped
  // grant reaches this lesson and nothing else (D-068).
  await requirePermission(
    actor.principal,
    "planning.manage",
    { session: sessionId },
    { at },
  );

  const laneIds = laneIdList(input.laneIds);

  await prisma.$transaction(async (tx) => {
    const session = await tx.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { id: true, groupId: true, poolId: true, laneSource: true },
    });
    if (!session) {
      throw new ScheduleError("notFound", "That lesson does not exist.");
    }

    await lanesInPool(tx, session.poolId, laneIds);

    await tx.scheduledSession.update({
      where: { id: sessionId },
      data: { laneSource: "OVERRIDE" },
    });
    await tx.sessionLane.deleteMany({ where: { sessionId } });
    if (laneIds.length > 0) {
      await tx.sessionLane.createMany({
        data: laneIds.map((laneId) => ({ sessionId, laneId })),
      });
    }

    await recordAuditEvent(
      {
        eventType: "sessions.session.lanes.overridden",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          groupId: session.groupId,
          fields: "laneSource",
          lanes: laneIds.length,
          // What it was before, because "this lesson used to follow the season
          // and now does not" is the change worth being able to see.
          previousSource: resolveLaneSource(session.laneSource),
        },
      },
      tx,
    );
  });
}

/**
 * Returns one lesson to following its season.
 *
 * THE WAY BACK, and it has to exist: an override entered on the wrong lesson is
 * an ordinary mistake, and without this the only repair would be re-entering
 * the season's lanes on that lesson by hand — which looks identical on the
 * screen and is not the same row, so the next change to the recurrence would
 * skip it for ever.
 *
 * It clears the marker and the rows TOGETHER. That pairing is the invariant the
 * database does not hold (see the migration's closing comment), so it is held
 * here, in one transaction, and pinned by `lane-assignment.test.ts`.
 *
 * A PINNED lesson can be cleared too, and that is deliberate rather than an
 * oversight: pinning is the application's own act, not a person's, and a person
 * who wants a past lesson to follow the season again is entitled to say so.
 */
export async function clearSessionLaneOverride(
  actor: ActorContext,
  sessionId: string,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { session: sessionId },
    { at },
  );

  await prisma.$transaction(async (tx) => {
    const session = await tx.scheduledSession.findUnique({
      where: { id: sessionId },
      select: { groupId: true, laneSource: true },
    });
    if (!session) {
      throw new ScheduleError("notFound", "That lesson does not exist.");
    }
    // Already inheriting: nothing to clear, and nothing to say about it.
    if (session.laneSource === null) return;

    await tx.sessionLane.deleteMany({ where: { sessionId } });
    await tx.scheduledSession.update({
      where: { id: sessionId },
      data: { laneSource: null },
    });

    await recordAuditEvent(
      {
        eventType: "sessions.session.lanes.cleared",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "scheduled_session",
        targetId: sessionId,
        requestId: actor.requestId ?? null,
        changedFields: {
          groupId: session.groupId,
          fields: "laneSource",
          previousSource: resolveLaneSource(session.laneSource),
        },
      },
      tx,
    );
  });
}
