/**
 * Presentation helpers for the skills catalogue and progress-log screens.
 *
 * SERVER-SIDE AND LOCALE-FIXED to `nl-NL`, on the `src/app/courses/format.ts`
 * pattern.
 */

/** `12-03-2026` for a calendar date held at UTC midnight. */
export function formatCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

/**
 * `12-03-2026 18:04` — `SkillProgress.assessedAt` is a full instant, not a
 * `@db.Date` calendar day, so unlike {@link formatCalendarDate} this renders
 * in the SERVER's local zone rather than pinning UTC. Good enough for a v1
 * teaching log; a per-organisation zone would need the same plumbing
 * `formatSessionMoment` (`src/app/groups/format.ts`) takes from the schedule.
 */
export function formatMoment(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/** `YYYY-MM-DD`, for a date input's `defaultValue`. */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}
