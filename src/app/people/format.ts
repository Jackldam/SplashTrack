import { getConfiguredLocalization, formatDateTime } from "@/lib/settings";

/**
 * Two kinds of "when" render differently here, and conflating them is a real bug
 * rather than a nicety.
 *
 * A CALENDAR DATE — a birthday, the day a membership period started, the day a
 * child left — is a day, not an instant. `Person.dateOfBirth` is a `DATE`
 * column and the period columns hold UTC-midnight values written from a
 * `YYYY-MM-DD` form field. Rendering those through the organisation's configured
 * time zone moves them: anywhere west of Greenwich, a birthday of 1 May renders
 * as 30 April, and D-151's whole control is a comparison against that date.
 *
 * A TIMESTAMP — when a row was written — IS an instant, and belongs in the
 * organisation's zone through the shared `formatDateTime`, which also honours
 * their configured locale, style and clock convention.
 */

/** A calendar date, in UTC, with no time. Never the configured zone. */
export function formatCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}

/** The value a `<input type="date">` wants back. */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** A real instant, in the organisation's configured zone and style. */
export async function formatMoment(value: Date): Promise<string> {
  return formatDateTime(value, await getConfiguredLocalization());
}
