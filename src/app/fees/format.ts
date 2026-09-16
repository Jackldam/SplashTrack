/**
 * Presentation helpers for the fees screens — the `src/app/courses/format.ts`
 * / `src/app/people/format.ts` shape: server-side, locale-fixed to `nl-NL`
 * (`CLAUDE.md` §3 — D-159 governs identifiers, not what an administrator
 * reads).
 *
 * `formatMoney` is the ONE place in this area a minor-unit integer is
 * converted to a JavaScript number, and it is DISPLAY-ONLY: the result is a
 * rendered string, never fed back into a calculation or stored anywhere.
 * `Intl.NumberFormat`'s own rounding to two fraction digits absorbs the
 * float imprecision a `/ 100` division can introduce at this scale, which is
 * why every actual sum in this module (`domain/balance.ts`,
 * `domain/money.ts`) stays in integer minor units throughout and only
 * crosses to a float here, at the very end, for a human to read.
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

/** `YYYY-MM-DD`, for a date input's `defaultValue`. */
export function toDateInputValue(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** `€67,50` — a minor-unit amount, rendered for a person to read. */
export function formatMoney(
  amountMinorUnits: number,
  currency: string,
): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
  }).format(amountMinorUnits / 100);
}
