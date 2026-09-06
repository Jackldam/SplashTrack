/**
 * Presentation helpers for the groups and schedule screens.
 *
 * SERVER-SIDE AND LOCALE-FIXED to `nl-NL`, matching `src/app/people/format.ts`:
 * these render on the server, so a browser locale cannot shift them, and the UI
 * language is Dutch by default (`CLAUDE.md` §3 — D-159 governs identifiers, not
 * what an instructor reads at the poolside).
 *
 * The organisation's configured zone is passed IN rather than read here, so a
 * page renders every timestamp in the same zone the generator used. See
 * `@/modules/sessions` `zoned-time.ts` for why that matters.
 */

/** `12-03-2026` for a calendar date held at UTC midnight. */
export function formatCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    // UTC, deliberately: a `@db.Date` is a calendar day stored at UTC midnight,
    // and rendering it in a zone west of Greenwich would show the day before.
    timeZone: "UTC",
  }).format(value);
}

/** `di 12 mrt 18:00` — the timetable's own line. */
export function formatSessionMoment(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(value);
}

/** `18:00` from minutes past local midnight. */
export function formatMinuteOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** ISO weekday 1–7 as its Dutch name. */
const WEEKDAYS = [
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
  "zondag",
] as const;

export function formatWeekday(isoWeekday: number): string {
  return WEEKDAYS[isoWeekday - 1] ?? String(isoWeekday);
}

/** `YYYY-MM-DD`, for a date input's `defaultValue`. */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}
