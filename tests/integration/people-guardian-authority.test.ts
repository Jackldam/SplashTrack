import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma, prisma } from "@/lib/database";
import {
  AGE_OF_DIGITAL_CONSENT_YEARS,
  ORGANIZATION_ID,
  coerceOrganizationConfig,
  defaultOrganizationConfig,
  validateOrganizationConfigInput,
} from "@/lib/settings";
import { ApiError } from "@/lib/errors";
import {
  describeRelationshipAuthority,
  recordRelationship,
  type ActorContext,
} from "@/modules/people";

import { emptyWorld } from "../support/authorization-fixtures";
import {
  grantTo,
  installRelations,
  makePerson,
  makeRole,
  PEOPLE_ADMIN_PERMISSIONS,
  resetPeopleFixtures,
} from "../support/people-fixtures";

/**
 * D-151 END TO END: the CONFIGURED age of digital consent, reaching the
 * derivation, against a REAL `PersonRelationship` row.
 *
 * The unit suite proves the rule. This proves the wiring — that the number an
 * administrator can change is the number the derivation uses, and that a child
 * crossing the threshold changes the answer WITH NO JOB HAVING RUN and NO ROW
 * HAVING BEEN TOUCHED.
 *
 * The last part is asserted literally: `updatedAt` is compared before and after
 * the child is "sixteen". If anything ever starts marking rows on a birthday,
 * this is the test that goes red.
 */

const CHILD_BORN = new Date("2010-05-03T00:00:00Z");
const DAY_BEFORE_SIXTEEN = new Date("2026-05-02T12:00:00Z");
const SIXTEENTH_BIRTHDAY = new Date("2026-05-03T00:00:00Z");

let actor: ActorContext;
let child: string;
let parent: string;
let relationshipId: string;

/** Writes the instance's configuration document directly. */
async function setAgeOfConsent(years: number | null): Promise<void> {
  const config = defaultOrganizationConfig();
  if (years !== null) config.privacy.ageOfDigitalConsentYears = years;
  // The document is a plain, JSON-serialisable object; Prisma's Json input type
  // wants an index signature the typed interface deliberately does not have.
  const document = config as unknown as Prisma.InputJsonValue;
  await prisma.organization.upsert({
    where: { id: ORGANIZATION_ID },
    update: { config: document },
    create: { id: ORGANIZATION_ID, config: document },
  });
}

describe("D-151 guardian authority, end to end", () => {
  beforeEach(async () => {
    await resetPeopleFixtures();
    installRelations(emptyWorld());

    const administrator = await makePerson("ga_admin");
    const role = await makeRole("role_ga", [...PEOPLE_ADMIN_PERMISSIONS]);
    await grantTo({
      personId: administrator,
      roleId: role,
      scopeType: "ORGANIZATION",
    });
    actor = {
      principal: { personId: administrator },
      at: DAY_BEFORE_SIXTEEN,
    };

    child = await makePerson("ga_child", { dateOfBirth: CHILD_BORN });
    parent = await makePerson("ga_parent");

    ({ relationshipId } = await recordRelationship(actor, {
      subjectPersonId: child,
      relativePersonId: parent,
      type: "GUARDIAN_OF",
      authority: true,
      evidence: "moeder, opgegeven bij inschrijving",
      validFrom: "2020-01-01",
    }));

    await setAgeOfConsent(AGE_OF_DIGITAL_CONSENT_YEARS.default);
  });

  afterAll(async () => {
    await resetPeopleFixtures();
    await setAgeOfConsent(null);
  });

  /** The row, as the person page reads it. */
  async function relationship() {
    const row = await prisma.personRelationship.findUniqueOrThrow({
      where: { id: relationshipId },
      select: {
        authority: true,
        validFrom: true,
        validTo: true,
        updatedAt: true,
        toPerson: { select: { dateOfBirth: true } },
      },
    });
    return {
      authority: row.authority,
      validFrom: row.validFrom,
      validTo: row.validTo,
      subjectDateOfBirth: row.toPerson.dateOfBirth,
      updatedAt: row.updatedAt,
    };
  }

  it("LAPSES on the birthday, and NOTHING was written to make that happen", async () => {
    const row = await relationship();

    const before = await describeRelationshipAuthority(row, DAY_BEFORE_SIXTEEN);
    const after = await describeRelationshipAuthority(row, SIXTEENTH_BIRTHDAY);

    expect(before.status).toBe("ACTIVE");
    expect(before.effective).toBe(true);
    expect(after.status).toBe("LAPSED_BY_AGE");
    expect(after.effective).toBe(false);
    expect(after.requiresReconsent).toBe(true);

    // THE ASSERTION THAT MAKES THIS D-151 RATHER THAN A CACHED FLAG. No job
    // ran, and the row is byte-for-byte what it was: same `authority`, same
    // `validTo`, same `updatedAt`. The answer changed because the question
    // moved, which is the only mechanism that cannot be behind schedule.
    const stillTheSameRow = await relationship();
    expect(stillTheSameRow.authority).toBe(true);
    expect(stillTheSameRow.validTo).toBeNull();
    expect(stillTheSameRow.updatedAt).toEqual(row.updatedAt);
  });

  it("uses the CONFIGURED age, not a constant — thirteen lapses where sixteen does not", async () => {
    const row = await relationship();
    const at = new Date("2024-01-01T00:00:00Z"); // the child is thirteen

    await setAgeOfConsent(16);
    expect((await describeRelationshipAuthority(row, at)).status).toBe(
      "ACTIVE",
    );

    await setAgeOfConsent(13);
    expect((await describeRelationshipAuthority(row, at)).status).toBe(
      "LAPSED_BY_AGE",
    );
  });

  it("reports the date it lapses, so a screen can say WHEN and not only WHETHER", async () => {
    const result = await describeRelationshipAuthority(
      await relationship(),
      DAY_BEFORE_SIXTEEN,
    );
    expect(result.lapsesOn).toEqual(new Date("2026-05-03T00:00:00.000Z"));
  });

  it("a child with NO date of birth lapses, visibly (D-172)", async () => {
    const unknown = await makePerson("ga_unknown", { dateOfBirth: null });
    const { relationshipId: id } = await recordRelationship(actor, {
      subjectPersonId: unknown,
      relativePersonId: parent,
      type: "GUARDIAN_OF",
      authority: true,
      evidence: "vader, geen geboortedatum in de oude ledenlijst",
    });

    const row = await prisma.personRelationship.findUniqueOrThrow({
      where: { id },
      select: {
        authority: true,
        validFrom: true,
        validTo: true,
        toPerson: { select: { dateOfBirth: true } },
      },
    });

    const result = await describeRelationshipAuthority(
      {
        authority: row.authority,
        validFrom: row.validFrom,
        validTo: row.validTo,
        subjectDateOfBirth: row.toPerson.dateOfBirth,
      },
      DAY_BEFORE_SIXTEEN,
    );

    // Not `false`, and not a silent pass: a NAMED outcome a human can act on.
    // A placeholder date would have been indistinguishable from a real one and
    // is forbidden outright.
    expect(result.status).toBe("LAPSED_UNKNOWN_BIRTHDATE");
    expect(result.requiresReconsent).toBe(true);
  });

  it("falls back to the default when the stored document is corrupt, never to another country's law", async () => {
    // The asymmetry with the session timeouts, asserted. Those fall back to
    // their FLOOR on a bad read, because a widened session cap is a security
    // control quietly relaxed. "Strictest" has no meaning for a legal
    // threshold: thirteen lapses authority earlier and eighteen later, and
    // neither is the law here.
    const coerced = coerceOrganizationConfig({
      privacy: { ageOfDigitalConsentYears: "sixteen" },
    });
    expect(coerced.privacy.ageOfDigitalConsentYears).toBe(
      AGE_OF_DIGITAL_CONSENT_YEARS.default,
    );
  });

  it("refuses an out-of-range age on the WRITE path rather than clamping it", async () => {
    // D-150's `bounded` class: a silently clamped write tells the administrator
    // their value was accepted. The bounds are Art. 8(1)'s own — a member state
    // may set thirteen to sixteen — so twenty-one is not a number to round.
    const current = defaultOrganizationConfig();
    expect(() =>
      validateOrganizationConfigInput(
        { privacy: { ageOfDigitalConsentYears: 21 } },
        current,
      ),
    ).toThrow(ApiError);
    expect(
      validateOrganizationConfigInput(
        { privacy: { ageOfDigitalConsentYears: 13 } },
        current,
      ).privacy.ageOfDigitalConsentYears,
    ).toBe(13);
  });
});
