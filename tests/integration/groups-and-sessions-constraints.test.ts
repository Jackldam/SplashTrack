/**
 * The constraints the Prisma DSL cannot express, each named and each proved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A TEST PER CONSTRAINT AND NOT A COMMENT
 *
 * These live in `prisma/migrations/20260906060000_groups_and_sessions/
 * migration.sql` as hand-written SQL. They are therefore INVISIBLE in
 * `schema.prisma`, and the failure mode is not that somebody argues with them —
 * it is a future "regenerate the migrations from the schema" tidy-up that drops
 * them silently, leaving a database that accepts a cancelled lesson with no
 * reason and two open placements for one child in one group.
 *
 * Naming each one in a test is what makes that tidy-up go red. The same
 * reasoning `person-relationship-constraints.test.ts` and
 * `retention-policy-constraints.test.ts` already carry.
 *
 * EVERY ASSERTION WRITES THROUGH RAW PRISMA, deliberately bypassing the services.
 * The services refuse these cases too, and that is where an administrator gets a
 * sentence they can act on — but a service check holds only for code that goes
 * through it, and the point of a CHECK constraint is that it holds for the path
 * nobody has written yet.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/database";

import {
  gid,
  makeGroup,
  makePerson,
  makeStudent,
  resetGroupsFixtures,
} from "../support/groups-fixtures";

let groupId: string;
let otherGroupId: string;
let studentProfileId: string;
let personId: string;

beforeEach(async () => {
  await resetGroupsFixtures();
  groupId = await makeGroup("c_group");
  otherGroupId = await makeGroup("c_other");
  personId = await makePerson("c_person");
  ({ studentProfileId } = await makeStudent("c_pupil"));
});

afterAll(async () => {
  await resetGroupsFixtures();
});

describe("GroupMembership", () => {
  it("GroupMembership_window_order_check — refuses an end before the start", async () => {
    // An interval active for no instant at all reads as a silently dead
    // placement, and D-145 rule 1 reads `toDate` to decide access.
    await expect(
      prisma.groupMembership.create({
        data: {
          groupId,
          studentProfileId,
          fromDate: new Date("2026-03-10T00:00:00Z"),
          toDate: new Date("2026-03-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/GroupMembership_window_order_check/);
  });

  it("GroupMembership_single_open_placement_key — refuses two OPEN placements in one group", async () => {
    await prisma.groupMembership.create({
      data: { groupId, studentProfileId, fromDate: new Date("2026-01-06") },
    });
    // "Is this child in this group right now" must not be a question with two
    // answers — the failure a status flag has.
    await expect(
      prisma.groupMembership.create({
        data: { groupId, studentProfileId, fromDate: new Date("2026-03-03") },
      }),
    ).rejects.toThrow(/GroupMembership_single_open_placement_key/);
  });

  it("permits an open placement in a DIFFERENT group at the same time", async () => {
    // A child in a lesson group and a club-swimming group is ordinary, so the
    // partial unique is scoped to the group and not to the pupil.
    await prisma.groupMembership.create({
      data: { groupId, studentProfileId, fromDate: new Date("2026-01-06") },
    });
    await expect(
      prisma.groupMembership.create({
        data: {
          groupId: otherGroupId,
          studentProfileId,
          fromDate: new Date("2026-01-06"),
        },
      }),
    ).resolves.toBeDefined();
  });

  it("permits overlapping CLOSED placements", async () => {
    // A club back-filling its paper history produces them. Refusing legitimate
    // history to enforce tidiness is how a status flag gets reinvented.
    await prisma.groupMembership.create({
      data: {
        groupId,
        studentProfileId,
        fromDate: new Date("2026-01-06"),
        toDate: new Date("2026-03-03"),
      },
    });
    await expect(
      prisma.groupMembership.create({
        data: {
          groupId,
          studentProfileId,
          fromDate: new Date("2026-02-01"),
          toDate: new Date("2026-04-01"),
        },
      }),
    ).resolves.toBeDefined();
  });
});

describe("GroupMove", () => {
  it("GroupMove_reason_required_check — refuses a blank reason", async () => {
    // NOT NULL alone would accept a space. D-108: the reason is the entire value
    // of the record, and a move down with a blank one is exactly the row that
    // reads as an administrative error to the parent looking at it.
    await expect(
      prisma.groupMove.create({
        data: {
          studentProfileId,
          toGroupId: groupId,
          direction: "DOWN",
          reason: "   ",
          occurredAt: new Date("2026-03-03"),
        },
      }),
    ).rejects.toThrow(/GroupMove_reason_required_check/);
  });

  it("GroupMove_distinct_groups_check — refuses a move from a group to itself", async () => {
    await expect(
      prisma.groupMove.create({
        data: {
          studentProfileId,
          fromGroupId: groupId,
          toGroupId: groupId,
          direction: "LATERAL",
          reason: "geen echte verplaatsing",
          occurredAt: new Date("2026-03-03"),
        },
      }),
    ).rejects.toThrow(/GroupMove_distinct_groups_check/);
  });

  it("accepts DOWN on exactly the terms it accepts UP", async () => {
    // The database is the last place a direction could acquire an asymmetry —
    // an extra constraint on one value would be invisible in the module and
    // decisive in production.
    for (const direction of ["UP", "DOWN", "LATERAL"] as const) {
      await expect(
        prisma.groupMove.create({
          data: {
            studentProfileId,
            fromGroupId: otherGroupId,
            toGroupId: groupId,
            direction,
            reason: "gewone lesbeslissing",
            occurredAt: new Date("2026-03-03"),
          },
        }),
      ).resolves.toBeDefined();
    }
  });
});

describe("InstructorAssignment", () => {
  it("InstructorAssignment_window_order_check — refuses an end before the start", async () => {
    await expect(
      prisma.instructorAssignment.create({
        data: {
          personId,
          groupId,
          fromDate: new Date("2026-03-10"),
          toDate: new Date("2026-03-01"),
        },
      }),
    ).rejects.toThrow(/InstructorAssignment_window_order_check/);
  });

  it("InstructorAssignment_single_open_assignment_key — refuses two open assignments", async () => {
    // "When did they stop teaching this group" is the question D-145 rule 1
    // turns into an access decision. Two open rows make it ambiguous.
    await prisma.instructorAssignment.create({
      data: { personId, groupId, fromDate: new Date("2026-01-06") },
    });
    await expect(
      prisma.instructorAssignment.create({
        data: { personId, groupId, fromDate: new Date("2026-03-03") },
      }),
    ).rejects.toThrow(/InstructorAssignment_single_open_assignment_key/);
  });
});

describe("Group and Pool", () => {
  it("Group_capacity_positive_check — refuses a capacity of zero or less", async () => {
    // D-180's placement screen would report the group as permanently full for a
    // value nobody meant to type.
    await expect(
      prisma.group.create({
        data: { id: gid("c_zero"), name: "Nul", capacity: 0 },
      }),
    ).rejects.toThrow(/Group_capacity_positive_check/);
  });

  it("permits a NULL capacity — unknown, not unlimited", async () => {
    await expect(
      prisma.group.create({
        data: { id: gid("c_null"), name: "Onbekend", capacity: null },
      }),
    ).resolves.toBeDefined();
  });

  it("Pool_length_positive_check — refuses a non-positive length", async () => {
    await expect(
      prisma.pool.create({
        data: { id: gid("c_pool"), name: "Nulbad", lengthMetres: 0 },
      }),
    ).rejects.toThrow(/Pool_length_positive_check/);
  });
});

describe("SessionRecurrence", () => {
  const base = {
    startMinuteOfDay: 18 * 60,
    durationMinutes: 45,
    startsOn: new Date("2026-03-01T00:00:00Z"),
  };

  it("SessionRecurrence_weekday_range_check — refuses a weekday outside 1..7", async () => {
    // Every one of these produces ZERO SESSIONS rather than an error, which
    // would present as a broken generator instead of as bad data. That is the
    // failure mode worth four CHECK constraints.
    for (const weekday of [0, 8, -1]) {
      await expect(
        prisma.sessionRecurrence.create({
          data: { groupId, weekday, ...base },
        }),
      ).rejects.toThrow(/SessionRecurrence_weekday_range_check/);
    }
  });

  it("SessionRecurrence_start_minute_range_check — refuses a minute outside the day", async () => {
    await expect(
      prisma.sessionRecurrence.create({
        data: { groupId, weekday: 2, ...base, startMinuteOfDay: 1440 },
      }),
    ).rejects.toThrow(/SessionRecurrence_start_minute_range_check/);
  });

  it("SessionRecurrence_duration_range_check — refuses a zero-length lesson", async () => {
    await expect(
      prisma.sessionRecurrence.create({
        data: { groupId, weekday: 2, ...base, durationMinutes: 0 },
      }),
    ).rejects.toThrow(/SessionRecurrence_duration_range_check/);
  });

  it("SessionRecurrence_window_order_check — permits a one-day rule, refuses a backwards one", async () => {
    // `>=` and not `>`: a rule that runs for one day is a legitimate one-off
    // somebody entered as a rule.
    await expect(
      prisma.sessionRecurrence.create({
        data: {
          groupId,
          weekday: 2,
          ...base,
          endsOn: new Date("2026-03-01T00:00:00Z"),
        },
      }),
    ).resolves.toBeDefined();

    await expect(
      prisma.sessionRecurrence.create({
        data: {
          groupId: otherGroupId,
          weekday: 2,
          ...base,
          endsOn: new Date("2026-02-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow(/SessionRecurrence_window_order_check/);
  });
});

describe("ScheduleException", () => {
  it("ScheduleException_window_order_check — permits a one-day closure", async () => {
    await expect(
      prisma.scheduleException.create({
        data: {
          groupId: null,
          fromDate: new Date("2026-03-17T00:00:00Z"),
          toDate: new Date("2026-03-17T00:00:00Z"),
          reason: `${gid("")}bad in onderhoud`,
        },
      }),
    ).resolves.toBeDefined();
  });

  it("ScheduleException_reason_required_check — refuses a blank reason", async () => {
    // An unexplained hole in a timetable is a support question.
    await expect(
      prisma.scheduleException.create({
        data: {
          groupId,
          fromDate: new Date("2026-03-01T00:00:00Z"),
          toDate: new Date("2026-03-07T00:00:00Z"),
          reason: "  ",
        },
      }),
    ).rejects.toThrow(/ScheduleException_reason_required_check/);
  });
});

describe("ScheduledSession", () => {
  const lesson = {
    occursOn: new Date("2026-03-03T00:00:00Z"),
    startsAt: new Date("2026-03-03T17:00:00Z"),
    endsAt: new Date("2026-03-03T17:45:00Z"),
  };

  it("ScheduledSession_window_order_check — refuses an end at or before the start", async () => {
    await expect(
      prisma.scheduledSession.create({
        data: {
          groupId,
          ...lesson,
          endsAt: new Date("2026-03-03T17:00:00Z"),
        },
      }),
    ).rejects.toThrow(/ScheduledSession_window_order_check/);
  });

  it("ScheduledSession_cancellation_shape_check — refuses CANCELLED with no reason", async () => {
    // The row a parent asks about and nobody can answer.
    await expect(
      prisma.scheduledSession.create({
        data: {
          groupId,
          ...lesson,
          status: "CANCELLED",
          cancelledAt: new Date("2026-03-01T00:00:00Z"),
          cancellationReason: null,
        },
      }),
    ).rejects.toThrow(/ScheduledSession_cancellation_shape_check/);
  });

  it("ScheduledSession_cancellation_shape_check — refuses a reason on a SCHEDULED lesson", async () => {
    // The equality, not two one-way implications: a lesson carrying a
    // cancellation reason while still going ahead reads as both on and off, and
    // this is what makes UNCANCELLING have to clear the fields.
    await expect(
      prisma.scheduledSession.create({
        data: {
          groupId,
          ...lesson,
          status: "SCHEDULED",
          cancellationReason: "toch niet",
        },
      }),
    ).rejects.toThrow(/ScheduledSession_cancellation_shape_check/);
  });

  it("ScheduledSession_recurrenceId_occursOn_key — the idempotency key", async () => {
    const recurrence = await prisma.sessionRecurrence.create({
      data: {
        groupId,
        weekday: 2,
        startMinuteOfDay: 18 * 60,
        durationMinutes: 45,
        startsOn: new Date("2026-03-01T00:00:00Z"),
      },
      select: { id: true },
    });

    await prisma.scheduledSession.create({
      data: { groupId, recurrenceId: recurrence.id, ...lesson },
    });
    // THE PROPERTY GENERATION RESTS ON. Not a check in the service — the
    // database refuses the second row.
    await expect(
      prisma.scheduledSession.create({
        data: { groupId, recurrenceId: recurrence.id, ...lesson },
      }),
    ).rejects.toThrow();
  });

  it("permits two hand-scheduled lessons on one date — NULLs are distinct", async () => {
    // Postgres treats NULL as distinct in a unique index, which is exactly what
    // lets a club schedule two extra lessons by hand on one day without the
    // idempotency key getting in the way.
    await prisma.scheduledSession.create({
      data: { groupId, recurrenceId: null, ...lesson },
    });
    await expect(
      prisma.scheduledSession.create({
        data: { groupId, recurrenceId: null, ...lesson },
      }),
    ).resolves.toBeDefined();
  });
});

describe("SessionRosterEntry", () => {
  it("refuses the same pupil twice on one lesson", async () => {
    const session = await prisma.scheduledSession.create({
      data: {
        groupId,
        occursOn: new Date("2026-03-03T00:00:00Z"),
        startsAt: new Date("2026-03-03T17:00:00Z"),
        endsAt: new Date("2026-03-03T17:45:00Z"),
      },
      select: { id: true },
    });

    await prisma.sessionRosterEntry.create({
      data: { sessionId: session.id, studentProfileId, source: "GUEST" },
    });
    await expect(
      prisma.sessionRosterEntry.create({
        data: { sessionId: session.id, studentProfileId, source: "GROUP" },
      }),
    ).rejects.toThrow();
  });
});
