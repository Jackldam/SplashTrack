/**
 * Input bounds and coercion for everything this module writes.
 *
 * SERVER-SIDE AND FIRST. Every write path in this module runs its input through
 * here before it reaches a service, because the surfaces are Server Actions —
 * which accept a `FormData` from anywhere, not only from the form that rendered
 * it. A `maxLength` in the markup is a courtesy to the person typing; this is
 * the control.
 *
 * The bounds are generous on purpose. They exist to stop unbounded storage from
 * a crafted request, not to enforce a house style on a name — refusing a
 * legitimate Dutch surname because it is long is a defect that reaches a real
 * family, and `Passkey.name`'s own server-side backstop carries the same
 * reasoning.
 */
import { ApiError, type ApiErrorDetail } from "@/lib/errors";

export const TEXT_MAX = {
  /** Comfortably past the longest real name; a bound, not a rule. */
  name: 120,
  /** RFC 5321 caps an address at 254 octets. */
  email: 254,
  /** International formats with extensions and a note fit well inside this. */
  phone: 64,
  /** A sentence, not a case file. */
  reason: 500,
  /**
   * Guardian authority evidence (D-063). Longer than the other free text
   * because it records HOW a claim was established — a court order reference, a
   * date, who saw what — and truncating that produces evidence that no longer
   * supports the claim it exists for.
   */
  evidence: 2000,
  /** A search box. */
  query: 120,
} as const;

function fail(field: string, issue: string): never {
  const detail: ApiErrorDetail = { field, issue };
  throw new ApiError(
    "VALIDATION_ERROR",
    "De ingevoerde gegevens kloppen niet.",
    {
      details: [detail],
    },
  );
}

/** Required, trimmed, bounded text. */
export function requiredText(
  field: string,
  value: unknown,
  max: number,
): string {
  if (typeof value !== "string") fail(field, "Must be text.");
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(field, "Must not be empty.");
  if (trimmed.length > max) fail(field, `Must be at most ${max} characters.`);
  return trimmed;
}

/** Optional, trimmed, bounded text; empty becomes null. */
export function optionalText(
  field: string,
  value: unknown,
  max: number,
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field, "Must be text.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) fail(field, `Must be at most ${max} characters.`);
  return trimmed;
}

/**
 * An optional CALENDAR DATE, parsed from an `YYYY-MM-DD` form field into a UTC
 * midnight instant.
 *
 * PARSED STRICTLY, and a blank is null rather than "today". D-172 forbids a
 * synthesised `dateOfBirth` outright — "a placeholder date is indistinguishable
 * from a real one the moment it is written" — so an unparseable value is
 * REFUSED and an absent one stays absent, deriving guardian authority to lapsed
 * where it matters. Neither is ever quietly replaced with a plausible date.
 */
export function optionalDate(field: string, value: unknown): Date | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field, "Must be a date.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    fail(field, "Must be a date in the form YYYY-MM-DD.");
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) fail(field, "Is not a real date.");
  // Round-trips: `2026-02-31` parses to 3 March and would otherwise be silently
  // accepted as a date the person did not enter.
  if (parsed.toISOString().slice(0, 10) !== trimmed) {
    fail(field, "Is not a real date.");
  }
  return parsed;
}

/** A required calendar date, same parsing rules. */
export function requiredDate(field: string, value: unknown): Date {
  const parsed = optionalDate(field, value);
  if (parsed === null) fail(field, "Must not be empty.");
  return parsed;
}

/** A required member of a closed set. */
export function requiredEnum<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    fail(field, `Must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}
