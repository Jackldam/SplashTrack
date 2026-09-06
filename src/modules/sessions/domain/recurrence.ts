/**
 * Expanding a recurrence into the lessons it produces — the pure half of
 * generation, with no database and no clock of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE DESIGN DOES NOT SAY, AND WHAT WAS DECIDED INSTEAD
 *
 * **Nothing in the design set creates a `ScheduledSession`.** No chapter, no
 * decision. §4.1's flagship attendance screen begins *"Today → [Start session]"*
 * and there is no path by which a session comes to exist. Six groups across
 * thirty-six teaching weeks is about two hundred rows, and nobody is going to
 * type them.
 *
 * So recurrence and closures are additions, and the shape of them was asked of
 * the domain expert and not answered inside the build window. What is
 * implemented, and why:
 *
 *   - **Weekly, and a group may have several rules.** A group swimming Tuesday
 *     and Thursday is two rules. Several subsumes one, so a "one slot per group"
 *     answer needs no migration — only a screen that offers one. Monthly and
 *     n-weekly patterns are NOT built: no swim school described one, and an
 *     unused recurrence engine is the apparatus §4.0 spends a page arguing
 *     against.
 *   - **Closures are date RANGES, club-wide by default.** A school holiday is a
 *     fortnight, not fourteen decisions, and `groupId = null` means everything.
 *   - **A term is a `from`/`to` the administrator supplies**, not a `Term`
 *     entity. The design names no such concept and inventing one would put a
 *     second home beside `SessionRecurrence.startsOn`/`endsOn`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS PURE
 *
 * Every decision about WHICH DATES a rule produces is made here, from values,
 * with no query and no `new Date()`. That is what makes "generating a term twice
 * produces the same set" and "a configured holiday is skipped" testable as
 * arithmetic rather than through a database — and the idempotency the definition
 * of done asks for is then a property of the WRITE, which is a separate, much
 * smaller thing to get right.
 */

import { addDays, isoWeekday, toIsoDate } from "./zoned-time";

/** A weekly rule, as the expander needs it. */
export interface RecurrenceRule {
  readonly id: string;
  /** ISO-8601: 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
  readonly startMinuteOfDay: number;
  readonly durationMinutes: number;
  /** First calendar date the rule may produce, at UTC midnight. */
  readonly startsOn: Date;
  /** Last date it may, or null for open-ended. */
  readonly endsOn: Date | null;
  readonly active: boolean;
}

/**
 * A closure. `groupId === null` is CLUB-WIDE, which is the ordinary case: the
 * pool is shut, so nothing runs.
 *
 * Inclusive at both ends — a one-day closure has `fromDate === toDate`. The
 * half-open convention would make a single day look like a mistake to the
 * administrator typing it, and this is a field an administrator types.
 */
export interface ClosureWindow {
  readonly groupId: string | null;
  readonly fromDate: Date;
  readonly toDate: Date;
  readonly reason: string;
}

/** One occurrence a rule produced, before anything is written. */
export interface PlannedOccurrence {
  readonly recurrenceId: string;
  /** The local calendar date, at UTC midnight. The idempotency key's other half. */
  readonly occursOn: Date;
  readonly startMinuteOfDay: number;
  readonly durationMinutes: number;
}

/** An occurrence a rule WOULD have produced, and why it did not. */
export interface SkippedOccurrence {
  readonly recurrenceId: string;
  readonly occursOn: Date;
  readonly reason: string;
}

export interface ExpansionResult {
  readonly planned: readonly PlannedOccurrence[];
  /**
   * REPORTED, not swallowed. An administrator who asks for a term and gets 34
   * lessons where they expected 36 needs to see *"kerstvakantie"* beside the two
   * gaps — otherwise the only way to tell a working holiday calendar from a
   * broken generator is to count.
   */
  readonly skipped: readonly SkippedOccurrence[];
}

/** Is this calendar date inside an inclusive closure window? */
function closes(window: ClosureWindow, date: Date): boolean {
  return (
    window.fromDate.getTime() <= date.getTime() &&
    date.getTime() <= window.toDate.getTime()
  );
}

/**
 * The closure that covers one date for one group, or null.
 *
 * ONE HOME FOR "club-wide, or this group's, both ends inclusive" (D-134).
 * `expandRecurrence` below asks it per occurrence it is about to plan, and
 * `updateRecurrence` asks it of a date a lesson has just been MOVED to — moving
 * a season from Tuesday to Thursday can walk a lesson onto the club's Christmas
 * fortnight, and that is worth counting rather than discovering at the pool.
 */
export function closureCovering(
  closures: readonly ClosureWindow[],
  groupId: string,
  date: Date,
): ClosureWindow | null {
  return (
    closures.find(
      (closure) =>
        (closure.groupId === null || closure.groupId === groupId) &&
        closes(closure, date),
    ) ?? null
  );
}

/**
 * The dates one rule produces between `from` and `to` inclusive, minus the
 * closures that apply to it.
 *
 * `from`/`to` are the ADMINISTRATOR's window — "generate this term" — and the
 * rule's own `startsOn`/`endsOn` narrow it further. Asking for a year when the
 * rule only runs a term produces the term, not an error: the intersection is the
 * answer to both questions at once.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  from: Date,
  to: Date,
  closures: readonly ClosureWindow[],
  groupId: string,
): ExpansionResult {
  const planned: PlannedOccurrence[] = [];
  const skipped: SkippedOccurrence[] = [];

  if (!rule.active) return { planned, skipped };

  // The intersection of the caller's window and the rule's own.
  const start = rule.startsOn.getTime() > from.getTime() ? rule.startsOn : from;
  const end =
    rule.endsOn !== null && rule.endsOn.getTime() < to.getTime()
      ? rule.endsOn
      : to;
  if (start.getTime() > end.getTime()) return { planned, skipped };

  // Walk forward to the first matching weekday, then step a week at a time.
  // Bounded by construction: the offset never exceeds seven, and each iteration
  // advances by exactly seven days toward `end`.
  const offset = (rule.weekday - isoWeekday(start) + 7) % 7;
  let cursor = addDays(start, offset);

  while (cursor.getTime() <= end.getTime()) {
    const closure = closureCovering(closures, groupId, cursor);
    if (closure) {
      skipped.push({
        recurrenceId: rule.id,
        occursOn: cursor,
        reason: closure.reason,
      });
    } else {
      planned.push({
        recurrenceId: rule.id,
        occursOn: cursor,
        startMinuteOfDay: rule.startMinuteOfDay,
        durationMinutes: rule.durationMinutes,
      });
    }
    cursor = addDays(cursor, 7);
  }

  return { planned, skipped };
}

/**
 * Every rule for one group, expanded and merged.
 *
 * Two rules can legitimately land on the same date — a group swimming twice a
 * week, or two overlapping rules an administrator has not yet tidied — and they
 * stay separate occurrences, because `(recurrenceId, occursOn)` is the
 * idempotency key and the two rules are different sessions at different times.
 * Deduplicating by DATE alone would silently drop the second lesson of the week.
 */
export function expandAll(
  rules: readonly RecurrenceRule[],
  from: Date,
  to: Date,
  closures: readonly ClosureWindow[],
  groupId: string,
): ExpansionResult {
  const planned: PlannedOccurrence[] = [];
  const skipped: SkippedOccurrence[] = [];
  for (const rule of rules) {
    const result = expandRecurrence(rule, from, to, closures, groupId);
    planned.push(...result.planned);
    skipped.push(...result.skipped);
  }
  planned.sort(
    (left, right) =>
      left.occursOn.getTime() - right.occursOn.getTime() ||
      left.startMinuteOfDay - right.startMinuteOfDay,
  );
  skipped.sort(
    (left, right) => left.occursOn.getTime() - right.occursOn.getTime(),
  );
  return { planned, skipped };
}

/** The stable key of one occurrence — what makes generation idempotent. */
export function occurrenceKey(occurrence: PlannedOccurrence): string {
  return `${occurrence.recurrenceId}@${toIsoDate(occurrence.occursOn)}`;
}
