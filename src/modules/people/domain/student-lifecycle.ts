/**
 * The pupil's lifecycle, derived from an APPEND-ONLY event log (D-059, D-005).
 *
 * One persistent `StudentProfile`, created once and never duplicated on return,
 * with a history of what happened to it. There is no status column, for the same
 * reason `Membership` has no flag: the current state is cheap to derive and the
 * history is impossible to recover once overwritten.
 *
 * A correction is a NEW event. Nothing here updates or deletes one, and the
 * module exposes no path that does (`CLAUDE.md` rule 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT `PAUSED` MEANS, AND WHY IT IS NOT `LEFT`
 *
 * A paused pupil is still the school's pupil — a broken arm, a term abroad, a
 * family taking a break. They keep their profile, their skills and their place
 * in the club's mind, and D-066 keeps holding their `Person` because the
 * relationship has not ended. `LEFT` is the only event that ends it.
 *
 * That distinction is load-bearing for retention: treating a pause as an ending
 * would start a 24-month clock on a child who is coming back in September.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE "MOVED GROUP" IS
 *
 * Not here. `01-domain-model.md` §2.2 gives a group move its own entity,
 * `GroupMove`, owned by the `groups` module — it needs the two group ids this
 * table has nowhere to put, and D-134 allows the fact exactly one home.
 *
 * The domain constraint that travels with it, from Jack: **moving a child DOWN a
 * level must be as ordinary in the history as moving up.** No direction flag
 * that reads as a failure, no "demotion" wording, no screen rendering one
 * direction in red. Written here because this is where a reader looking for
 * "moved group" arrives.
 */

/** Mirrors the Prisma `StudentLifecycleEventType` enum. */
export type StudentLifecycleEventType =
  "JOINED" | "PAUSED" | "LEFT" | "RETURNED" | "TRIAL_ATTENDED";

export interface LifecycleEvent {
  readonly type: StudentLifecycleEventType;
  readonly occurredAt: Date;
}

/**
 * The pupil's current state, derived.
 *
 * `PROSPECTIVE` is the state of a profile whose only event is a trial lesson —
 * *proefzwemmen*, an enrolment concept for someone who has not joined yet
 * (`docs/glossary.md`). It is a real state and not a gap: the club has a record
 * of the child, and that record holds their `Person` under D-066, so calling it
 * "unknown" would be a retention decision dressed as an absence.
 */
export type StudentLifecycleState =
  "PROSPECTIVE" | "ACTIVE" | "PAUSED" | "LEFT";

/**
 * The state as of `at`, from the latest event at or before it.
 *
 * Events are ordered by `occurredAt` — WHEN IT HAPPENED, not when it was typed
 * in. A club that catches up on Monday morning enters Saturday's departure with
 * Saturday's date, and the derivation must agree with the club's own account of
 * its week. Ties break on the order given, which the repository fixes as
 * `(occurredAt, id)` so the answer is stable rather than merely usually right.
 *
 * A profile with NO events at all is `ACTIVE`: it exists because somebody
 * registered a pupil, and nothing says otherwise. Reporting `PROSPECTIVE`
 * instead would treat "the administrator has not recorded a JOINED event yet" as
 * "this child is not our pupil", which is the wrong direction for a record whose
 * existence is itself the registration.
 */
export function currentLifecycleState(
  events: readonly LifecycleEvent[],
  at: Date,
): StudentLifecycleState {
  const applicable = events.filter((event) => event.occurredAt <= at);
  const latest = applicable.at(-1);
  if (!latest) return "ACTIVE";

  switch (latest.type) {
    case "TRIAL_ATTENDED":
      // Only while nothing else has happened. A trial followed by JOINED is an
      // active pupil; a trial AFTER a departure is a returning family looking
      // again, and is prospective once more.
      return "PROSPECTIVE";
    case "JOINED":
    case "RETURNED":
      return "ACTIVE";
    case "PAUSED":
      return "PAUSED";
    case "LEFT":
      return "LEFT";
  }
}

/**
 * When this pupil's relationship with the school ended, for D-066.
 *
 * `null` — still held (active, paused, or prospective; a pause is not an
 * ending). `Date` — the moment of the `LEFT` event that is currently in force.
 *
 * Derived from the state rather than from "the latest `LEFT` event", so a pupil
 * who left in 2024 and returned in 2026 is HELD, and the 2024 row is history
 * rather than a retention trigger somebody has to remember to override.
 */
export function lifecycleEndedAt(
  events: readonly LifecycleEvent[],
  at: Date,
): Date | null {
  if (currentLifecycleState(events, at) !== "LEFT") return null;
  const applicable = events.filter((event) => event.occurredAt <= at);
  return applicable.at(-1)?.occurredAt ?? null;
}
