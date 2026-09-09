/**
 * D-151 — guardian authority expires by operation of law at the age of digital
 * consent, and the system COMPUTES that rather than waiting for someone to set a
 * `validTo`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PURE FUNCTION AND NOT A JOB, A COLUMN OR A TRIGGER
 *
 * A swim school's eight-year-olds become sixteen well inside the retention
 * window. Parental authority lapses on a birthday, not on an administrator
 * remembering — so any mechanism that has to RUN in order to be right is wrong
 * by construction: a job that has not run yet leaves authority apparently valid,
 * which is the F-119 failure, and a stored boolean is that job's output with the
 * same staleness baked in. Evaluated at read time, a predicate cannot be behind
 * schedule. This is the same argument D-144 makes for grant expiry, and it is
 * why D-151 calls this "the cheapest control in this section".
 *
 * Nothing in this file writes anything. It is called wherever a guardian
 * relationship is displayed or relied upon.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR OUTCOMES, AND WHY THERE ARE FOUR RATHER THAN A BOOLEAN
 *
 * D-151 requires a lapsed consent to be marked **requiring re-consent** — "not
 * silently invalid and not silently valid" — and D-172 requires an unknown date
 * of birth to be VISIBLE rather than merely safe. A boolean cannot carry either.
 * So the result names its own reason, and the re-consent queue, the privacy
 * screen and the person page all render from the same value:
 *
 *   ACTIVE                  — claimed, evidenced, in window, subject below the age.
 *   LAPSED_BY_AGE           — the subject reached the age of digital consent.
 *                             THE ROW IS UNTOUCHED; only the derivation says so.
 *   LAPSED_BY_RECORD        — the relationship's own `validTo` has passed, or its
 *                             `validFrom` has not arrived. An administrative fact.
 *   LAPSED_UNKNOWN_BIRTHDATE — the subject has no `dateOfBirth`. D-172: unknown
 *                             date ⇒ authority treated as LAPSED, so the case
 *                             produces a queue item a human resolves rather than
 *                             a silent boolean nobody can audit.
 *
 * `NOT_CLAIMED` is the fifth and is not a lapse: an emergency contact, or a
 * guardian relationship recorded without an authority claim, never had authority
 * to lose and must not appear in a re-consent queue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 *
 * It is NOT an authorization decision. `RELATED` was removed from `ScopeType`
 * and must not return (OD-5, D-161): a guardian's consent authority is a FACT on
 * a `PersonRelationship` row, consulted by the consent module, and it reaches
 * nothing. `ACTIVE` here gives its holder no read of anything, and no call site
 * may treat it as though it did.
 *
 * It is also NOT a claim about legal validity (D-063). The application cannot
 * verify guardianship; it records what it was told, by whom, and how the claim
 * was established. `ACTIVE` means "this recorded claim has not lapsed", never
 * "this person is the legal guardian".
 */

/** What the derivation needs about the relationship. */
export interface GuardianAuthorityInput {
  /** Does the row CLAIM authority (`PersonRelationship.authority`)? */
  readonly authority: boolean;
  /** When the relationship was recorded as beginning. */
  readonly validFrom: Date;
  /** When it was recorded as ending; null = standing. */
  readonly validTo: Date | null;
  /**
   * The SUBJECT's date of birth — the child's, never the guardian's. Null is a
   * real, expected value (D-172) and derives to lapsed.
   */
  readonly subjectDateOfBirth: Date | null;
}

export type GuardianAuthorityStatus =
  | "ACTIVE"
  | "LAPSED_BY_AGE"
  | "LAPSED_BY_RECORD"
  | "LAPSED_UNKNOWN_BIRTHDATE"
  | "NOT_CLAIMED";

export interface GuardianAuthority {
  readonly status: GuardianAuthorityStatus;
  /** True only for `ACTIVE`. The one thing a caller may act on. */
  readonly effective: boolean;
  /**
   * True when a consent resting on this relationship must be re-obtained — the
   * three `LAPSED_*` outcomes, and never `NOT_CLAIMED`. This is the flag D-151's
   * re-consent queue is built from.
   */
  readonly requiresReconsent: boolean;
  /**
   * The date the subject reaches the age of digital consent, when it can be
   * computed. Null when there is no date of birth. Diagnostic — it is what lets
   * a screen say *"vervalt op 3 mei 2027"* instead of only *"geldig"*.
   */
  readonly lapsesOn: Date | null;
}

/**
 * The instant a person born on `dateOfBirth` reaches `ageYears`.
 *
 * Calendar arithmetic in UTC, on a column stored as a DATE. A birthday is a
 * calendar day, not an instant — someone born on 29 February reaches sixteen on
 * 1 March in a non-leap year, which `setUTCFullYear` produces by normalising
 * 29 February 2042 to 1 March 2042, and that is the right answer rather than an
 * edge case to special-case. Authority lapses at the START of that day: the
 * person is sixteen all day, and a control that waited until midnight would give
 * a guardian one more day of authority than the law does.
 */
export function ageThresholdDate(dateOfBirth: Date, ageYears: number): Date {
  const threshold = new Date(
    Date.UTC(
      dateOfBirth.getUTCFullYear() + ageYears,
      dateOfBirth.getUTCMonth(),
      dateOfBirth.getUTCDate(),
    ),
  );
  return threshold;
}

/**
 * Has this person reached the age of digital consent as of `at`?
 *
 * A null date of birth returns TRUE — reached, therefore authority lapsed. That
 * is D-172's "unknown date ⇒ authority treated as lapsed", and it is the safe
 * direction because the failure it produces is a visible queue item rather than
 * a guardian silently retaining authority over an adult.
 */
export function hasReachedAgeOfConsent(
  dateOfBirth: Date | null,
  ageOfConsentYears: number,
  at: Date,
): boolean {
  if (dateOfBirth === null) return true;
  return at >= ageThresholdDate(dateOfBirth, ageOfConsentYears);
}

/**
 * D-151's derivation. No I/O, no clock of its own, no writes.
 *
 * `at` is explicit rather than `new Date()` per call so one request evaluates
 * every relationship against one instant — the same rule `requirePermission` and
 * `coversResource` follow, and for the same reason.
 */
export function resolveGuardianAuthority(
  input: GuardianAuthorityInput,
  ageOfConsentYears: number,
  at: Date,
): GuardianAuthority {
  const lapsesOn =
    input.subjectDateOfBirth === null
      ? null
      : ageThresholdDate(input.subjectDateOfBirth, ageOfConsentYears);

  // Never claimed ⇒ nothing to lapse, and nothing for the re-consent queue.
  // Checked FIRST: an emergency contact whose window has closed is not a
  // "lapsed authority", and putting it in the queue would bury the items that
  // need a human.
  if (!input.authority) {
    return {
      status: "NOT_CLAIMED",
      effective: false,
      requiresReconsent: false,
      lapsesOn,
    };
  }

  // The ADMINISTRATIVE window — what the school was told. Checked before age so
  // a relationship the school has already ended does not also report an age
  // lapse it never reached.
  if (at < input.validFrom || (input.validTo !== null && at >= input.validTo)) {
    return {
      status: "LAPSED_BY_RECORD",
      effective: false,
      requiresReconsent: true,
      lapsesOn,
    };
  }

  if (input.subjectDateOfBirth === null) {
    return {
      status: "LAPSED_UNKNOWN_BIRTHDATE",
      effective: false,
      requiresReconsent: true,
      lapsesOn: null,
    };
  }

  if (hasReachedAgeOfConsent(input.subjectDateOfBirth, ageOfConsentYears, at)) {
    return {
      status: "LAPSED_BY_AGE",
      effective: false,
      requiresReconsent: true,
      lapsesOn,
    };
  }

  return {
    status: "ACTIVE",
    effective: true,
    requiresReconsent: false,
    lapsesOn,
  };
}
