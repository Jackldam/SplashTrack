/**
 * Server-side coercion for everything a module writes.
 *
 * SERVER-SIDE AND FIRST. Every write path in the application runs its input
 * through here before it reaches a service, because the surfaces are Server
 * Actions — which accept a `FormData` from anywhere, not only from the form that
 * rendered it. A `maxLength` in the markup is a courtesy to the person typing;
 * this is the control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS HERE AND NOT IN A MODULE
 *
 * It began as `src/modules/people/application/input.ts` and moved when
 * `groups` and `sessions` arrived needing the same six functions. A module never
 * imports another module's internals (`CLAUDE.md` §4), and `people` does not
 * export these — so the alternatives were three copies of `requiredText` that
 * drift, or one home. D-134's "a normative rule is stated once" decides it.
 *
 * WHAT DID **NOT** MOVE: the BOUNDS. `TEXT_MAX` stays per module, because how
 * long a group name may be and how long guardian-authority evidence may be are
 * different judgements about different data, and collapsing them into one shared
 * table is how a bound gets raised for the wrong reason. This file holds the
 * coercion; each module holds its own numbers.
 *
 * The bounds themselves are generous on purpose everywhere they are set. They
 * exist to stop unbounded storage from a crafted request, not to enforce a house
 * style — refusing a legitimate Dutch surname because it is long is a defect
 * that reaches a real family.
 */
import { ApiError, type ApiErrorDetail } from "@/lib/errors";

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

/**
 * An optional whole number within an inclusive range; a blank becomes null.
 *
 * STRICT ABOUT THE STRING, because the callers are `FormData` fields and
 * `Number("")` is 0 — which would turn an untouched capacity box into a group
 * that is permanently full. `Number(" 12 ")` is 12 and that is fine; anything
 * that is not entirely a number is refused rather than coerced.
 */
export function optionalInt(
  field: string,
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value == null) return null;
  if (typeof value === "number") return checkedInt(field, value, min, max);
  if (typeof value !== "string") fail(field, "Must be a whole number.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^-?\d+$/.test(trimmed)) fail(field, "Must be a whole number.");
  return checkedInt(field, Number(trimmed), min, max);
}

/** A required whole number within an inclusive range. */
export function requiredInt(
  field: string,
  value: unknown,
  min: number,
  max: number,
): number {
  const parsed = optionalInt(field, value, min, max);
  if (parsed === null) fail(field, "Must not be empty.");
  return parsed;
}

function checkedInt(
  field: string,
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value)) fail(field, "Must be a whole number.");
  if (value < min || value > max) {
    fail(field, `Must be between ${min} and ${max}.`);
  }
  return value;
}

/**
 * A TIME OF DAY as minutes past local midnight, parsed from an `HH:MM` field —
 * the shape `<input type="time">` submits.
 *
 * Minutes and not a `Date`, because a lesson's time of day is not an instant: it
 * is 18:00 every Tuesday, and which instant that is depends on the date and the
 * zone. Keeping the two apart until generation is what makes a recurrence
 * survive a DST change. See `@/modules/sessions` `zoned-time.ts`.
 */
export function requiredTimeOfDay(field: string, value: unknown): number {
  if (typeof value !== "string") fail(field, "Must be a time like 18:00.");
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) fail(field, "Must be a time like 18:00.");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) fail(field, "Is not a real time.");
  return hours * 60 + minutes;
}
