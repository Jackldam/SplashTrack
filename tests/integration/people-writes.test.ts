import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { keyIdOf } from "@/lib/crypto";
import { prisma } from "@/lib/database";
import {
  createMembership,
  createPerson,
  createStudentProfile,
  endMembershipPeriod,
  isCurrentlyAMember,
  MembershipPeriodError,
  recordLifecycleEvent,
  recordRelationship,
  revealRelationshipEvidence,
  startMembershipPeriod,
  updatePerson,
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
 * The `people` module's WRITES, against a real database, through the real
 * services — guard, transaction, audit event and all.
 *
 * Three properties this file exists to hold:
 *
 *   1. **Leave-and-return produces TWO `MembershipPeriod` rows and destroys no
 *      history** (D-059). The failure it guards against is not exotic: it is
 *      the natural implementation, in which "they came back" reopens the row
 *      that says when they left.
 *   2. **Every personal-data write has an audit event** (`CLAUDE.md` rule 2),
 *      carrying identifiers and field NAMES and never a value.
 *   3. **The first production encrypted column really is encrypted** — the
 *      stored bytes are an envelope, `open()` returns the plaintext, and the
 *      general read path never carries either.
 */

const NOW = new Date("2026-05-12T18:30:00Z");

let administrator: string;
let adminRole: string;
let actor: ActorContext;

/**
 * Ids of the people the SERVICES created during a test.
 *
 * `resetPeopleFixtures()` deletes by id prefix, and it cannot reach these: a
 * service-created `Person` gets a `cuid(2)` from the schema, which is the whole
 * point of exercising the real write path. So they are tracked and removed
 * here. Without this, a member number written in one run collides with itself in
 * the next — which is exactly how this file first went red, and a good argument
 * for the unique index being real.
 */
const createdPeople: string[] = [];

async function newPerson(
  givenName: string,
  familyName: string,
  dateOfBirth?: string,
): Promise<string> {
  const { id } = await createPerson(actor, {
    givenName,
    familyName,
    dateOfBirth,
  });
  createdPeople.push(id);
  return id;
}

async function removeCreatedPeople(): Promise<void> {
  if (createdPeople.length === 0) return;
  const where = { personId: { in: createdPeople } };
  await prisma.personRelationship.deleteMany({
    where: {
      OR: [
        { fromPersonId: { in: createdPeople } },
        { toPersonId: { in: createdPeople } },
      ],
    },
  });
  await prisma.studentLifecycleEvent.deleteMany({
    where: { studentProfile: where },
  });
  await prisma.studentProfile.deleteMany({ where });
  await prisma.membershipPeriod.deleteMany({ where: { membership: where } });
  await prisma.membership.deleteMany({ where });
  await prisma.person.deleteMany({ where: { id: { in: createdPeople } } });
  createdPeople.length = 0;
}

async function seed(): Promise<void> {
  await removeCreatedPeople();
  await resetPeopleFixtures();
  administrator = await makePerson("writer_admin");
  adminRole = await makeRole("role_writer", [...PEOPLE_ADMIN_PERMISSIONS]);
  await grantTo({
    personId: administrator,
    roleId: adminRole,
    scopeType: "ORGANIZATION",
  });
  actor = { principal: { personId: administrator }, at: NOW };
  installRelations(emptyWorld());
}

/** Every audit event written about one target, newest last. */
async function auditFor(targetId: string) {
  return prisma.auditEvent.findMany({
    where: { targetId },
    orderBy: { sequence: "asc" },
    select: {
      eventType: true,
      outcome: true,
      actorPersonId: true,
      targetType: true,
      changedFields: true,
    },
  });
}

describe("people writes (real database, real services)", () => {
  beforeEach(seed);
  afterAll(async () => {
    await removeCreatedPeople();
    await resetPeopleFixtures();
  });

  // ── Leave and return ─────────────────────────────────────────────────────

  describe("leave and return (D-059)", () => {
    it("produces TWO periods, keeps the first one intact, and keeps ONE member number", async () => {
      const personId = await newPerson("Sanne", "Terugkomer");

      const { membershipId, memberNumber } = await createMembership(
        actor,
        personId,
        { startedAt: "2020-09-01" },
      );

      await endMembershipPeriod(actor, personId, {
        endedAt: "2022-07-01",
        endReason: "verhuisd",
      });

      await startMembershipPeriod(actor, personId, { startedAt: "2025-09-01" });

      const periods = await prisma.membershipPeriod.findMany({
        where: { membershipId },
        orderBy: { startedAt: "asc" },
        select: { startedAt: true, endedAt: true, endReason: true },
      });

      // TWO ROWS. Not one row mutated twice, and not a second `Membership`.
      expect(periods).toHaveLength(2);

      // THE FIRST PERIOD IS UNTOUCHED. This is the assertion that fails if
      // "they came back" is ever implemented as reopening the closed row —
      // which would silently delete the answer to "when were they a member?".
      expect(periods[0]).toEqual({
        startedAt: new Date("2020-09-01T00:00:00.000Z"),
        endedAt: new Date("2022-07-01T00:00:00.000Z"),
        endReason: "verhuisd",
      });
      expect(periods[1].startedAt).toEqual(
        new Date("2025-09-01T00:00:00.000Z"),
      );
      expect(periods[1].endedAt).toBeNull();

      // ONE membership row, one number, unchanged across the gap (§3.1).
      const memberships = await prisma.membership.findMany({
        where: { personId },
        select: { memberNumber: true },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].memberNumber).toBe(memberNumber);

      // And the derived answers the deleted status flag used to give, now
      // answered from the rows — including the GAP, which a flag destroys.
      const intervals = periods.map((period) => ({
        startedAt: period.startedAt,
        endedAt: period.endedAt,
      }));
      expect(isCurrentlyAMember(intervals, new Date("2021-01-01"))).toBe(true);
      expect(isCurrentlyAMember(intervals, new Date("2023-01-01"))).toBe(false);
      expect(isCurrentlyAMember(intervals, NOW)).toBe(true);
    });

    it("refuses a SECOND open period rather than letting 'are they a member' have two answers", async () => {
      const personId = await newPerson("Twee", "Periodes");
      await createMembership(actor, personId, { startedAt: "2020-09-01" });

      await expect(
        startMembershipPeriod(actor, personId, { startedAt: "2021-01-01" }),
      ).rejects.toBeInstanceOf(MembershipPeriodError);
    });

    it("the partial unique index holds even if the service check is bypassed", async () => {
      // The domain check is the MESSAGE; the index is the CONTROL. Written
      // straight to the table, past every service, exactly as a race would.
      const personId = await newPerson("Race", "Conditie");
      const { membershipId } = await createMembership(actor, personId, {});

      await expect(
        prisma.membershipPeriod.create({
          data: { membershipId, startedAt: new Date("2026-01-01") },
        }),
      ).rejects.toThrow(/MembershipPeriod_single_open_period_key/);
    });

    it("refuses to end a period before it started", async () => {
      const personId = await newPerson("Tijd", "Reiziger");
      await createMembership(actor, personId, { startedAt: "2025-09-01" });
      await expect(
        endMembershipPeriod(actor, personId, { endedAt: "2024-01-01" }),
      ).rejects.toBeInstanceOf(MembershipPeriodError);
    });
  });

  // ── An audit event for every personal-data write ─────────────────────────

  describe("every personal-data write is audited (CLAUDE.md rule 2)", () => {
    it("records one event per write, with the actor, and with field NAMES only", async () => {
      const personId = await newPerson("Audit", "Spoor", "2015-04-01");

      const created = await auditFor(personId);
      expect(created.map((event) => event.eventType)).toEqual([
        "people.person.created",
      ]);
      expect(created[0].actorPersonId).toBe(administrator);
      expect(created[0].targetType).toBe("person");
      expect(created[0].outcome).toBe("SUCCESS");

      // The CONTENT RULE, asserted rather than trusted: names of fields and
      // non-personal tokens, and not one syllable of what was typed. An audit
      // trail that recorded a child's name beside every change would become the
      // largest personal-data store in the system, append-only and
      // uncorrectable.
      const fields = created[0].changedFields as Record<string, unknown>;
      expect(fields).toEqual({
        fields: "givenName,familyName,dateOfBirth,email,phone",
        dateOfBirthKnown: true,
      });
      expect(JSON.stringify(fields)).not.toContain("Audit");
      expect(JSON.stringify(fields)).not.toContain("2015-04-01");

      await updatePerson(actor, personId, {
        givenName: "Audit",
        familyName: "Gewijzigd",
      });
      const updated = await auditFor(personId);
      expect(updated.map((event) => event.eventType)).toEqual([
        "people.person.created",
        "people.person.updated",
      ]);
      // Only what ACTUALLY changed, computed by comparison — so the trail says
      // "the family name changed" rather than "somebody submitted the form".
      expect((updated[1].changedFields as Record<string, unknown>).fields).toBe(
        "familyName,dateOfBirth",
      );
    });

    it("audits the membership, both period transitions, the pupil record and its lifecycle", async () => {
      const personId = await newPerson("Volledig", "Spoor");
      const { membershipId } = await createMembership(actor, personId, {
        startedAt: "2024-09-01",
      });
      await endMembershipPeriod(actor, personId, { endedAt: "2025-07-01" });
      const started = await startMembershipPeriod(actor, personId, {
        startedAt: "2026-01-01",
      });
      const { studentProfileId } = await createStudentProfile(
        actor,
        personId,
        {},
      );
      const { eventId } = await recordLifecycleEvent(actor, studentProfileId, {
        type: "PAUSED",
        occurredAt: "2026-03-01",
      });

      expect(
        (await auditFor(membershipId)).map((event) => event.eventType),
      ).toEqual(["people.membership.created"]);
      expect(
        (await auditFor(started.periodId)).map((event) => event.eventType),
      ).toEqual(["people.membership_period.started"]);
      expect(
        (await auditFor(studentProfileId)).map((event) => event.eventType),
      ).toEqual(["people.student_profile.created"]);

      const lifecycle = await auditFor(eventId);
      expect(lifecycle.map((event) => event.eventType)).toEqual([
        "people.student_lifecycle_event.recorded",
      ]);
      // The TYPE is a machine token from a closed set, and it is the fact an
      // auditor is actually looking for.
      expect((lifecycle[0].changedFields as Record<string, unknown>).type).toBe(
        "PAUSED",
      );

      // The ending is audited too, against the period it closed.
      const ended = await prisma.membershipPeriod.findFirst({
        where: { membershipId, NOT: { endedAt: null } },
        select: { id: true },
      });
      expect(
        (await auditFor(ended!.id)).map((event) => event.eventType),
      ).toEqual(["people.membership_period.ended"]);
    });

    it("writes NO audit event when a write is refused", async () => {
      // The event and the change are in one transaction, so a denial leaves
      // neither. An audit trail that recorded attempts as though they were
      // changes would be worse than one that recorded nothing.
      const personId = await newPerson("Geweigerd", "Persoon");
      const before = (await auditFor(personId)).length;

      await expect(
        updatePerson(actor, personId, { givenName: "", familyName: "" }),
      ).rejects.toThrow();

      expect((await auditFor(personId)).length).toBe(before);
    });

    it("rolls the audit event back with the write it evidences", async () => {
      // The reason `recordAuditEvent` takes the transaction client. Forcing the
      // transaction to fail AFTER the append must leave no event behind: an
      // append-only trail cannot be corrected, so a false entry is permanent.
      const personId = await newPerson("Rollback", "Persoon");
      const before = (await auditFor(personId)).length;

      // A duplicate member number: the unique index fires AFTER this call's own
      // audit append would have run in a naive implementation. Unique per RUN,
      // because the collision this test needs is one WITHIN it — never one with
      // a row an earlier run left behind, which is a different bug wearing the
      // same failure.
      const duplicate = `DUP-${Date.now()}`;
      await createMembership(actor, personId, { memberNumber: duplicate });
      const otherId = await newPerson("Rollback", "Tweede");
      await expect(
        createMembership(actor, otherId, { memberNumber: duplicate }),
      ).rejects.toThrow();

      // The SUCCESSFUL membership left its event; the failed one left none.
      // Counted by the personId the event carries, because a membership event
      // targets the membership row — which, for the failed attempt, does not
      // exist to be targeted, and that is precisely the point.
      const membershipEvents = await prisma.auditEvent.findMany({
        where: { eventType: "people.membership.created" },
        select: { changedFields: true },
      });
      const personOf = (event: { changedFields: unknown }) =>
        (event.changedFields as { personId?: string } | null)?.personId;

      expect(
        membershipEvents.filter((e) => personOf(e) === personId),
      ).toHaveLength(1);
      expect(
        membershipEvents.filter((e) => personOf(e) === otherId),
      ).toHaveLength(0);

      // And the second person's own trail is still just their creation: the
      // rolled-back transaction added nothing anywhere.
      expect((await auditFor(otherId)).length).toBe(1);
      expect((await auditFor(personId)).length).toBe(before);
    });
  });

  // ── The first production encrypted column ────────────────────────────────

  describe("PersonRelationship.evidence — the first production encrypted column", () => {
    it("stores an ENVELOPE, not the plaintext, and reads it back through open()", async () => {
      const child = await makePerson("crypto_child", {
        dateOfBirth: new Date("2016-06-01T00:00:00Z"),
      });
      const parent = await makePerson("crypto_parent");

      const plaintext =
        "moeder, opgegeven bij inschrijving 01-09-2024, legitimatie gezien";
      const { relationshipId } = await recordRelationship(actor, {
        subjectPersonId: child,
        relativePersonId: parent,
        type: "GUARDIAN_OF",
        authority: true,
        evidence: plaintext,
      });

      // What is actually in the column. Read raw, past every helper.
      const stored = await prisma.personRelationship.findUnique({
        where: { id: relationshipId },
        select: { evidence: true },
      });
      expect(stored?.evidence).toBeTruthy();
      expect(stored!.evidence).not.toContain("moeder");
      expect(stored!.evidence).not.toContain("legitimatie");
      expect(stored!.evidence).toMatch(/^v1:/);
      // The key generation is readable WITHOUT decrypting, which is what makes
      // a future rotation observable (D-096).
      expect(
        keyIdOf("person_relationships.authority_evidence", stored!.evidence!),
      ).toBe("1");

      // And it comes back.
      const revealed = await revealRelationshipEvidence(actor, relationshipId);
      expect(revealed?.evidence).toBe(plaintext);
    });

    it("audits the DISCLOSURE, and the audit event carries no evidence", async () => {
      const child = await makePerson("crypto_child2", {
        dateOfBirth: new Date("2016-06-01T00:00:00Z"),
      });
      const parent = await makePerson("crypto_parent2");
      const { relationshipId } = await recordRelationship(actor, {
        subjectPersonId: child,
        relativePersonId: parent,
        type: "GUARDIAN_OF",
        authority: true,
        evidence: "beschikking rechtbank gezien 14-03-2025",
      });

      await revealRelationshipEvidence(actor, relationshipId);

      const events = await auditFor(relationshipId);
      expect(events.map((event) => event.eventType)).toEqual([
        "people.relationship.recorded",
        "people.relationship.evidence_revealed",
      ]);
      // Recording it says only THAT evidence was recorded.
      expect(
        (events[0].changedFields as Record<string, unknown>).evidenceRecorded,
      ).toBe(true);
      expect(JSON.stringify(events)).not.toContain("rechtbank");
    });

    it("the general read path never carries the ciphertext — only whether evidence exists", async () => {
      const child = await makePerson("crypto_child3", {
        dateOfBirth: new Date("2016-06-01T00:00:00Z"),
      });
      const parent = await makePerson("crypto_parent3");
      const { relationshipId } = await recordRelationship(actor, {
        subjectPersonId: child,
        relativePersonId: parent,
        type: "GUARDIAN_OF",
        authority: true,
        evidence: "geheime onderbouwing",
      });

      const { getPersonForPrincipal } = await import("@/modules/people");
      const detail = await getPersonForPrincipal(actor, child);

      expect(detail?.evidenceAvailable.has(relationshipId)).toBe(true);
      // Not the value, and not the envelope either: a field that is merely
      // "usually not selected" is selected the first time somebody writes
      // `include: { relationships: true }`.
      expect(JSON.stringify(detail)).not.toContain("geheime");
      expect(JSON.stringify(detail)).not.toContain("v1:");
    });

    it("refuses an authority claim with no evidence — at the service AND at the database", async () => {
      const child = await makePerson("crypto_child4");
      const parent = await makePerson("crypto_parent4");

      // D-063: the application cannot verify guardianship; it records what it
      // was told and HOW. A claim with no recorded basis is the false comfort
      // that decides a custody dispute wrongly.
      await expect(
        recordRelationship(actor, {
          subjectPersonId: child,
          relativePersonId: parent,
          type: "GUARDIAN_OF",
          authority: true,
        }),
      ).rejects.toThrow(/D-063/);

      // Past the service, straight at the table.
      await expect(
        prisma.personRelationship.create({
          data: {
            fromPersonId: parent,
            toPersonId: child,
            type: "GUARDIAN_OF",
            authority: true,
          },
        }),
      ).rejects.toThrow(/PersonRelationship_evidence_required_check/);
    });

    it("refuses authority on an emergency contact, at the database too", async () => {
      const child = await makePerson("crypto_child5");
      const contact = await makePerson("crypto_contact5");
      await expect(
        prisma.personRelationship.create({
          data: {
            fromPersonId: contact,
            toPersonId: child,
            type: "EMERGENCY_CONTACT",
            authority: true,
            evidence: "irrelevant",
          },
        }),
      ).rejects.toThrow(/PersonRelationship_authority_kind_check/);
    });

    it("refuses a person as their own guardian", async () => {
      const person = await makePerson("crypto_self");
      await expect(
        prisma.personRelationship.create({
          data: {
            fromPersonId: person,
            toPersonId: person,
            type: "EMERGENCY_CONTACT",
          },
        }),
      ).rejects.toThrow(/PersonRelationship_no_self_reference_check/);
    });
  });

  // ── The pupil record ─────────────────────────────────────────────────────

  it("a returning pupil keeps ONE profile and gains an event — never a second profile", async () => {
    // D-059: "Returning creates a new period and new Enrolment / GroupMembership
    // rows — it never creates a second profile." A second profile fragments the
    // skills, diplomas and groups that are the product's whole value.
    const personId = await newPerson("Terug", "Zwemmer");
    const { studentProfileId } = await createStudentProfile(actor, personId, {
      occurredAt: "2022-09-01",
    });
    await recordLifecycleEvent(actor, studentProfileId, {
      type: "LEFT",
      occurredAt: "2024-03-15",
    });
    await recordLifecycleEvent(actor, studentProfileId, {
      type: "RETURNED",
      occurredAt: "2026-01-08",
    });

    await expect(
      prisma.studentProfile.count({ where: { personId } }),
    ).resolves.toBe(1);
    const events = await prisma.studentLifecycleEvent.findMany({
      where: { studentProfileId },
      orderBy: { occurredAt: "asc" },
      select: { type: true },
    });
    expect(events.map((event) => event.type)).toEqual([
      "JOINED",
      "LEFT",
      "RETURNED",
    ]);
  });
});
