/**
 * Turning a local wall-clock time into an instant, in a named IANA zone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL
 *
 * A recurrence says *"Tuesdays at 18:00"*. That is not an instant and cannot be
 * stored as one: which instant 18:00 is depends on the date, because the
 * Netherlands changes offset twice a year and **both changes fall inside a
 * swimming season** — the last Sunday in March and the last in October, with
 * teaching either side of each.
 *
 * Get this wrong in the obvious way — generate a term in February by adding
 * seven days to the first `startsAt` — and every lesson from April onward is an
 * hour out. Nobody notices in the data; they notice at the pool, in April, when
 * the instructor arrives at 19:00 for a lesson the app says is at 18:00.
 *
 * So the recurrence stores a WEEKDAY and MINUTES PAST LOCAL MIDNIGHT, and the
 * zone is applied once per generated date, here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO LIBRARY, AND WHY THAT IS SAFE
 *
 * `Intl.DateTimeFormat` with a `timeZone` is the platform's own copy of the
 * tzdata, and it is already what `@/lib/settings/format.ts` renders every
 * timestamp through. Adding a date library to compute an offset the runtime
 * already knows would be a dependency with its own tzdata to keep in step —
 * two sources for one fact.
 *
 * The algorithm is the standard two-pass one: guess that the wall time is UTC,
 * ask the zone what offset it had at that guess, correct, then ask again in case
 * the correction crossed a transition. It is exact everywhere except inside the
 * one hour a year that does not exist, which is handled below.
 */

/**
 * The zone's offset from UTC at `utcMs`, in milliseconds. Positive east of
 * Greenwich (Amsterdam is +3600000 in winter, +7200000 in summer).
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  // `hour12: false` renders midnight as 24 in some ICU versions. Normalise, or
  // every lesson at 00:00 lands a day out.
  const hour = value("hour") % 24;

  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    hour,
    value("minute"),
    value("second"),
  );
  return asIfUtc - utcMs;
}

/**
 * The instant at which the clock in `timeZone` reads this local date and time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO AWKWARD HOURS, STATED RATHER THAN HIDDEN
 *
 * **Spring forward** — 02:00 to 03:00 does not exist on the last Sunday in
 * March. A lesson nominally at 02:30 resolves to 03:30 local. That is the
 * conventional answer, and it is irrelevant in practice: no swim school teaches
 * at half past two in the morning.
 *
 * **Autumn back** — 02:00 to 03:00 happens twice in October. This returns the
 * FIRST of the two, which is the one a person means by "02:30". Same
 * irrelevance, same reason to say so out loud rather than discover it.
 *
 * Both are properties of civil time, not defects. What would be a defect is
 * silently producing a lesson an hour out for the other 8758 hours of the year,
 * and that is what the second pass prevents.
 */
export function wallClockToInstant(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );

  const firstOffset = zoneOffsetMs(guess, timeZone);
  let instant = guess - firstOffset;

  // The correction may itself have crossed a transition — that is exactly what
  // happens on the two changeover Sundays. Ask once more at the corrected
  // instant and prefer that answer.
  const secondOffset = zoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) instant = guess - secondOffset;

  return new Date(instant);
}

/**
 * The organisation's zone, or the runtime's own when none is configured.
 *
 * `localization.timeZone` is nullable and the application already treats null
 * this way — `formatDateTime` omits the `timeZone` option, which means the
 * runtime's. Generation follows the same rule rather than inventing a constant,
 * so the timetable is built in the zone the timetable is *displayed* in. The
 * generator reports which zone it used, so a surprise is visible rather than
 * silent.
 *
 * A HARD-CODED `Europe/Amsterdam` WOULD BE WORSE, not better: it would be right
 * for this club and silently wrong for the next, and it would disagree with the
 * formatter sitting next to it.
 */
export function resolveTimeZone(configured: string | null | undefined): string {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The ISO-8601 weekday of a calendar date: 1 = Monday … 7 = Sunday.
 *
 * Read off the UTC fields deliberately. Every date in this module is a
 * `@db.Date` — a calendar day, stored as UTC midnight — so `getUTCDay` reads the
 * day the operator typed. `getDay()` would read it in the SERVER's zone and
 * shift the whole timetable by one for any container running west of Greenwich.
 */
export function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/** `YYYY-MM-DD` for a calendar date held as UTC midnight. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A calendar date at UTC midnight, from its parts. */
export function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** The same calendar date, `days` later. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
