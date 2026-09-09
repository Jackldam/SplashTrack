/**
 * The bounds this module writes within.
 *
 * THE COERCION MOVED, THE NUMBERS DID NOT. `requiredText` and its siblings live
 * in `@/lib/validation` since `groups` and `sessions` arrived needing them — a
 * module never imports another module's internals (`CLAUDE.md` §4), and three
 * copies of `requiredText` drift. The BOUNDS stayed here, because how long a
 * surname may be is a judgement about names rather than a shared constant, and
 * collapsing every module's numbers into one table is how a bound gets raised
 * for the wrong reason.
 *
 * The bounds are generous on purpose. They exist to stop unbounded storage from
 * a crafted request, not to enforce a house style on a name — refusing a
 * legitimate Dutch surname because it is long is a defect that reaches a real
 * family, and `Passkey.name`'s own server-side backstop carries the same
 * reasoning.
 */

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

export {
  optionalDate,
  optionalText,
  requiredDate,
  requiredEnum,
  requiredText,
} from "@/lib/validation";
