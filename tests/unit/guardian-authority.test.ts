import { describe, expect, it } from "vitest";

import {
  ageThresholdDate,
  hasReachedAgeOfConsent,
  resolveGuardianAuthority,
} from "@/modules/people";

/**
 * D-151 — guardian authority expires by operation of law at the age of digital
 * consent, and the system COMPUTES that rather than waiting for someone to set a
 * `validTo`.
 *
 * THE PROPERTY THESE TESTS EXIST FOR: **nothing runs.** Every case below is a
 * pure call with an explicit instant. There is no job to schedule, no column to
 * update and no row to touch — a child who was fifteen at one `at` and sixteen
 * at the next produces a different answer from the SAME row. That is the whole
 * of F-119's fix: a job that has not run yet leaves authority apparently valid,
 * and a predicate cannot be behind schedule.
 *
 * The integration half — the configured age actually reaching this function,
 * against a real row — is `tests/integration/people-guardian-authority.test.ts`.
 */

const AGE = 16;

/** A guardian relationship recorded years ago and never ended. */
function standing(subjectDateOfBirth: Date | null) {
  return {
    authority: true,
    validFrom: new Date("2020-01-01T00:00:00Z"),
    validTo: null,
    subjectDateOfBirth,
  };
}

describe("ageThresholdDate", () => {
  it("is the same calendar day, N years on", () => {
    expect(
      ageThresholdDate(new Date("2010-05-03T00:00:00Z"), 16).toISOString(),
    ).toBe("2026-05-03T00:00:00.000Z");
  });

  it("keeps 29 February when the target year HAS one", () => {
    // 2008 + 16 = 2024, which is a leap year, so the leap-day child reaches
    // sixteen on their actual birthday.
    expect(
      ageThresholdDate(new Date("2008-02-29T00:00:00Z"), 16).toISOString(),
    ).toBe("2024-02-29T00:00:00.000Z");
  });

  it("normalises 29 February to 1 March when the target year has none", () => {
    // 2008 + 15 = 2023, which has no 29 February. The leap-day child reaches
    // fifteen on 1 March, and that is the right answer rather than an
    // off-by-one to paper over — the threshold must exist as a real instant for
    // every date of birth, or D-151's comparison has a hole one day wide.
    expect(
      ageThresholdDate(new Date("2008-02-29T00:00:00Z"), 15).toISOString(),
    ).toBe("2023-03-01T00:00:00.000Z");
  });
});

describe("hasReachedAgeOfConsent", () => {
  const dateOfBirth = new Date("2010-05-03T00:00:00Z");

  it("is false the day before the birthday", () => {
    expect(
      hasReachedAgeOfConsent(
        dateOfBirth,
        AGE,
        new Date("2026-05-02T23:59:59Z"),
      ),
    ).toBe(false);
  });

  it("is true from the FIRST INSTANT of the birthday", () => {
    // Authority lapses at the START of the day. The person is sixteen all day,
    // and a control that waited until midnight would give a guardian one more
    // day of authority than the law does.
    expect(
      hasReachedAgeOfConsent(
        dateOfBirth,
        AGE,
        new Date("2026-05-03T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("is TRUE for an unknown date of birth — D-172's safe direction", () => {
    expect(hasReachedAgeOfConsent(null, AGE, new Date("2026-05-03Z"))).toBe(
      true,
    );
  });
});

describe("resolveGuardianAuthority (D-151)", () => {
  it("is ACTIVE while the child is below the age of consent", () => {
    const result = resolveGuardianAuthority(
      standing(new Date("2015-09-01T00:00:00Z")),
      AGE,
      new Date("2026-05-12T00:00:00Z"),
    );
    expect(result).toEqual({
      status: "ACTIVE",
      effective: true,
      requiresReconsent: false,
      lapsesOn: new Date("2031-09-01T00:00:00Z"),
    });
  });

  it("LAPSES BY AGE on the birthday, with no row having changed", () => {
    const relationship = standing(new Date("2010-05-03T00:00:00Z"));

    const before = resolveGuardianAuthority(
      relationship,
      AGE,
      new Date("2026-05-02T12:00:00Z"),
    );
    const after = resolveGuardianAuthority(
      relationship,
      AGE,
      new Date("2026-05-03T00:00:00Z"),
    );

    // THE SAME INPUT OBJECT. Only the instant differs, which is the point:
    // nothing wrote anything between these two calls, and nothing had to.
    expect(before.status).toBe("ACTIVE");
    expect(before.effective).toBe(true);
    expect(after.status).toBe("LAPSED_BY_AGE");
    expect(after.effective).toBe(false);
    expect(after.requiresReconsent).toBe(true);
  });

  it("follows the CONFIGURED age rather than a constant", () => {
    // The same child, the same instant, two member states. D-151 says "a
    // configurable age-of-consent setting (NL: 16)" and this is what makes the
    // word `configurable` mean something.
    const relationship = standing(new Date("2012-01-01T00:00:00Z"));
    const at = new Date("2026-06-01T00:00:00Z");
    expect(resolveGuardianAuthority(relationship, 13, at).status).toBe(
      "LAPSED_BY_AGE",
    );
    expect(resolveGuardianAuthority(relationship, 16, at).status).toBe(
      "ACTIVE",
    );
  });

  it("an UNKNOWN date of birth lapses, and says which kind of lapse it is", () => {
    // D-172: "unknown date ⇒ authority treated as lapsed ⇒ the consent appears
    // in the re-consent queue". Failing to lapsed is the safe direction; naming
    // it separately is the VISIBLE one — a human can act on
    // LAPSED_UNKNOWN_BIRTHDATE and cannot act on a bare `false`.
    const result = resolveGuardianAuthority(standing(null), AGE, new Date());
    expect(result.status).toBe("LAPSED_UNKNOWN_BIRTHDATE");
    expect(result.effective).toBe(false);
    expect(result.requiresReconsent).toBe(true);
    expect(result.lapsesOn).toBeNull();
  });

  it("an ended relationship lapses BY RECORD, not by age", () => {
    // The school was told the relationship ended. That is an administrative
    // fact and it is reported as one — reporting an age lapse the child never
    // reached would send an administrator looking for a birthday.
    const result = resolveGuardianAuthority(
      {
        authority: true,
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validTo: new Date("2025-01-01T00:00:00Z"),
        subjectDateOfBirth: new Date("2015-09-01T00:00:00Z"),
      },
      AGE,
      new Date("2026-05-12T00:00:00Z"),
    );
    expect(result.status).toBe("LAPSED_BY_RECORD");
  });

  it("a relationship that has not begun yet is not yet effective", () => {
    const result = resolveGuardianAuthority(
      {
        authority: true,
        validFrom: new Date("2027-01-01T00:00:00Z"),
        validTo: null,
        subjectDateOfBirth: new Date("2015-09-01T00:00:00Z"),
      },
      AGE,
      new Date("2026-05-12T00:00:00Z"),
    );
    expect(result.effective).toBe(false);
  });

  it("a relationship claiming NO authority is NOT_CLAIMED and never in the queue", () => {
    // An emergency contact never had authority to lose. Reporting it as lapsed
    // would fill D-151's re-consent queue with rows nobody needs to act on,
    // which is how a queue stops being read.
    const result = resolveGuardianAuthority(
      {
        authority: false,
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validTo: null,
        subjectDateOfBirth: null,
      },
      AGE,
      new Date(),
    );
    expect(result.status).toBe("NOT_CLAIMED");
    expect(result.requiresReconsent).toBe(false);
  });
});
