/**
 * Shared server-side input coercion. One home for the six functions every
 * module's write path runs its `FormData` through (D-134) — the BOUNDS stay per
 * module. See `./input.ts` for why the split falls there.
 */
export {
  optionalDate,
  optionalInt,
  optionalText,
  requiredDate,
  requiredEnum,
  requiredInt,
  requiredText,
  requiredTimeOfDay,
} from "./input";
