/**
 * Money is an integer number of MINOR UNITS (eurocent) everywhere in this
 * module — `CLAUDE.md`'s "money uses integer minor units or another exact
 * decimal-safe representation; never binary floating point", applied.
 * `€67,50` is the integer `6750`. No function in this module ever divides,
 * multiplies by a fraction, or otherwise introduces a non-integer amount;
 * `sumMinorUnits` is addition, and addition of integers is exact.
 *
 * Pure. No I/O, no clock.
 */

/** Adds a list of minor-unit amounts. Empty sums to zero. */
export function sumMinorUnits(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/**
 * Renders a minor-unit integer as a decimal string — `6750` → `"67.50"`,
 * `-1234` → `"-12.34"` — for the CSV export and the screens. Integer
 * division and modulo ONLY; no floating-point division ever touches the
 * amount, so there is nothing here for a binary rounding error to corrupt.
 */
export function formatMinorUnitsAsDecimalString(
  amountMinorUnits: number,
): string {
  const negative = amountMinorUnits < 0;
  const absolute = Math.abs(amountMinorUnits);
  const whole = Math.trunc(absolute / 100);
  const cents = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(cents).padStart(2, "0")}`;
}

/**
 * The inverse of {@link formatMinorUnitsAsDecimalString} — `"67.50"` → `6750`
 * — for the one boundary where a person types an amount in whole currency
 * units: the fee-type form's `<input type="number" step="0.01">`, whose
 * SUBMITTED value is always period-decimal regardless of the browser's
 * display locale (the HTML spec's own rule for a number input).
 *
 * STRING ARITHMETIC ONLY — never `Number(value) * 100`, which reintroduces
 * exactly the binary-float error minor units exist to avoid (`0.1 * 100` is
 * `10.000000000000002` in IEEE 754). Returns `null` for anything that is not
 * a plain non-negative decimal with at most two fraction digits, so the
 * caller's own validation (`requiredInt`) is what actually enforces the
 * bound — this function only refuses to GUESS at an amount it cannot render
 * back exactly.
 */
export function parseEurosToMinorUnits(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) return null;
  const whole = match[1]!;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number(whole) * 100 + Number(fraction);
}
