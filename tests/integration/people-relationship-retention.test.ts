import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";
import { resolveLastRelationshipEnd } from "@/lib/retention/last-relationship";
import {
  guardianRelationshipSource,
  studentProfileSource,
} from "@/modules/people";

import { emptyWorld } from "../support/authorization-fixtures";
import {
  installRelations,
  makePerson,
  resetPeopleFixtures,
} from "../support/people-fixtures";

/**
 * D-066 against REAL ROWS, for the first time.
 *
 * *"A guardian is held only while the child they are guardian of is held —
 * which follows automatically from the rule rather than needing a special
 * case."*
 *
 * Phase 0.4b could only prove that claim against fake stand-in sources, because
 * `PersonRelationship` did not exist. The aggregation it proved has not changed
 * by one line; what has changed is that the sources plugged into it are now real
 * queries over real tables — which is what makes "follows automatically" a
 * statement about this system rather than about a test double.
 *
 * WHY THIS MATTERS BEYOND TIDINESS: the most common person in the database is a
 * child with no membership at all, and the second most common is their guardian,
 * who has no membership, no pupil record and no role. A retention rule keyed on
 * membership would retain both of them forever, silently (§5.1).
 */

let child: string;
let guardian: string;

describe("D-066 relationship sources over real rows", () => {
  beforeEach(async () => {
    await resetPeopleFixtures();
    installRelations(emptyWorld());
    child = await makePerson("ret_child");
    guardian = await makePerson("ret_guardian");
  });

  afterAll(resetPeopleFixtures);

  async function guardianOf(
    relativeId: string,
    subjectId: string,
    validTo: Date | null = null,
  ): Promise<void> {
    await prisma.personRelationship.create({
      data: {
        fromPersonId: relativeId,
        toPersonId: subjectId,
        type: "GUARDIAN_OF",
        validFrom: new Date("2020-01-01T00:00:00Z"),
        validTo,
      },
    });
  }

  async function pupil(
    personId: string,
    events: { type: "JOINED" | "LEFT" | "PAUSED"; occurredAt: string }[],
  ): Promise<void> {
    await prisma.studentProfile.create({
      data: {
        personId,
        studentNumber: `ret_${personId}`,
        lifecycleEvents: {
          create: events.map((event) => ({
            type: event.type,
            occurredAt: new Date(event.occurredAt),
          })),
        },
      },
    });
  }

  it("a person with NOTHING is held by nothing, and that is reported as unknown", async () => {
    // `undefined`, not "ended": a person no source has ever held is not a case
    // this function can date, and inventing a trigger date would start a
    // deletion clock nobody chose.
    await expect(resolveLastRelationshipEnd(child)).resolves.toBeUndefined();
  });

  it("a pupil is HELD while their profile has not ended", async () => {
    await pupil(child, [{ type: "JOINED", occurredAt: "2024-09-01" }]);
    await expect(studentProfileSource.resolve(child)).resolves.toEqual({
      held: true,
    });
    await expect(resolveLastRelationshipEnd(child)).resolves.toEqual({
      held: true,
    });
  });

  it("a PAUSED pupil is still held — a broken arm is not a departure", async () => {
    await pupil(child, [
      { type: "JOINED", occurredAt: "2024-09-01" },
      { type: "PAUSED", occurredAt: "2026-02-01" },
    ]);
    await expect(resolveLastRelationshipEnd(child)).resolves.toEqual({
      held: true,
    });
  });

  it("a pupil who LEFT is dated at that event", async () => {
    await pupil(child, [
      { type: "JOINED", occurredAt: "2022-09-01" },
      { type: "LEFT", occurredAt: "2025-06-30" },
    ]);
    await expect(resolveLastRelationshipEnd(child)).resolves.toEqual({
      held: false,
      endedAt: new Date("2025-06-30T00:00:00.000Z"),
    });
  });

  it("THE GUARDIAN IS HELD WHILE THE CHILD IS, with no guardian-specific rule anywhere", async () => {
    await pupil(child, [{ type: "JOINED", occurredAt: "2024-09-01" }]);
    await guardianOf(guardian, child);

    // The guardian has no membership, no pupil record and no role assignment.
    // Under a membership-keyed rule they would be retained forever, invisibly.
    await expect(resolveLastRelationshipEnd(guardian)).resolves.toEqual({
      held: true,
    });
  });

  it("the guardian's clock starts on the CHILD's ending date, not on their own", async () => {
    await pupil(child, [
      { type: "JOINED", occurredAt: "2022-09-01" },
      { type: "LEFT", occurredAt: "2025-06-30" },
    ]);
    await guardianOf(guardian, child);

    // The same date, reported verbatim. Nothing about the guardian's own end
    // date is stored or computed — that is what "follows automatically" means.
    await expect(resolveLastRelationshipEnd(guardian)).resolves.toEqual({
      held: false,
      endedAt: new Date("2025-06-30T00:00:00.000Z"),
    });
  });

  it("a guardian of TWO children is held until the LAST child's relationship ends", async () => {
    const second = await makePerson("ret_child_two");
    await pupil(child, [
      { type: "JOINED", occurredAt: "2020-09-01" },
      { type: "LEFT", occurredAt: "2023-06-30" },
    ]);
    await pupil(second, [
      { type: "JOINED", occurredAt: "2022-09-01" },
      { type: "LEFT", occurredAt: "2026-02-01" },
    ]);
    await guardianOf(guardian, child);
    await guardianOf(guardian, second);

    await expect(resolveLastRelationshipEnd(guardian)).resolves.toEqual({
      held: false,
      endedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
  });

  it("an ENDED relationship reports its own end date, whatever the child's status", async () => {
    // The school was told this person is no longer the guardian. That is an
    // administrative fact and it ends the relationship that held them, even
    // while the child is still enrolled.
    await pupil(child, [{ type: "JOINED", occurredAt: "2024-09-01" }]);
    await guardianOf(guardian, child, new Date("2025-01-15T00:00:00Z"));

    await expect(guardianRelationshipSource.resolve(guardian)).resolves.toEqual(
      {
        held: false,
        endedAt: new Date("2025-01-15T00:00:00.000Z"),
      },
    );
  });

  it("a mutual guardianship terminates instead of recursing forever", async () => {
    // Two adults each recorded as guardian of the other — a data-entry mistake
    // that a naive "ask the subject's full source list" would follow in a
    // circle until the stack ran out. The subject side is resolved over the
    // NON-guardian sources, so this is exactly one level deep.
    await guardianOf(guardian, child);
    await guardianOf(child, guardian);

    await expect(resolveLastRelationshipEnd(guardian)).resolves.toBeUndefined();
    await expect(resolveLastRelationshipEnd(child)).resolves.toBeUndefined();
  });

  it("a person who answers for nobody falls through to their OWN sources", async () => {
    await pupil(guardian, [{ type: "JOINED", occurredAt: "2024-09-01" }]);
    await expect(
      guardianRelationshipSource.resolve(guardian),
    ).resolves.toBeUndefined();
    await expect(resolveLastRelationshipEnd(guardian)).resolves.toEqual({
      held: true,
    });
  });

  it("takes the LATEST ending across every kind of relationship, not the first", async () => {
    // The aggregation rule itself, over two real sources: the person left as a
    // pupil in 2023 and their membership ran to 2026, so the retention clock
    // starts in 2026.
    await pupil(child, [
      { type: "JOINED", occurredAt: "2020-09-01" },
      { type: "LEFT", occurredAt: "2023-06-30" },
    ]);
    await prisma.membership.create({
      data: {
        personId: child,
        memberNumber: "ret_member_1",
        periods: {
          create: {
            startedAt: new Date("2020-09-01T00:00:00Z"),
            endedAt: new Date("2026-02-01T00:00:00Z"),
          },
        },
      },
    });

    await expect(resolveLastRelationshipEnd(child)).resolves.toEqual({
      held: false,
      endedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
  });
});
