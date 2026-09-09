/**
 * `listStudentCandidatesForPrincipal` — the guest picker's data — is
 * scope-correct: a caller is offered exactly the pupils their
 * `students.read` reach covers, and never the organisation's list by the
 * back door.
 *
 * The escape this exists for: the lesson screen's guest search is reachable
 * by whoever reaches the lesson, including a `GROUP`-scoped instructor and a
 * `SESSION`-scoped substitute — neither of whom may browse children they do
 * not teach (§6.2's primary internal threat). The filter under test is
 * `student-candidate-filter.ts`; every branch mirrors or NARROWS
 * `coversResource({ student })`, and the narrowings are asserted here too.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { listStudentCandidatesForPrincipal } from "@/modules/people";

import {
  addGuestRow,
  assignInstructorTo,
  grantTo,
  installRealRelations,
  makeGroup,
  makeLesson,
  makePerson,
  makeRole,
  makeStudent,
  placeInGroup,
  resetAttendanceFixtures,
} from "../support/attendance-fixtures";

const NOW = new Date("2026-03-10T18:00:00.000Z");

let readerRoleId: string;

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetAttendanceFixtures();
  readerRoleId = await makeRole("cand_role_reader", ["students.read"]);
});

afterAll(async () => {
  await resetAttendanceFixtures();
});

describe("the guest picker's candidate list", () => {
  it("a GROUP-scoped instructor is offered their own group's active members and NOBODY else — not even by name", async () => {
    const groupA = await makeGroup("cand_ga");
    const groupB = await makeGroup("cand_gb");
    const mine = await makeStudent("cand_mine");
    const other = await makeStudent("cand_other");
    await placeInGroup(groupA, mine.studentProfileId);
    await placeInGroup(groupB, other.studentProfileId);

    const instructorId = await makePerson("cand_instr");
    await assignInstructorTo(groupA, instructorId);
    await grantTo({
      personId: instructorId,
      roleId: readerRoleId,
      scopeType: "GROUP",
      scopeId: groupA,
    });

    // The shared fixture surname matches every pupil this file makes; only
    // the reachable one comes back.
    const all = await listStudentCandidatesForPrincipal(actorFor(instructorId));
    expect(all.map((row) => row.studentProfileId)).toEqual([
      mine.studentProfileId,
    ]);

    // Asking for the OTHER child by their exact name is not a way around it.
    const byName = await listStudentCandidatesForPrincipal(
      actorFor(instructorId),
      { query: "cand_other" },
    );
    expect(byName).toEqual([]);
  });

  it("a LAPSED membership offers nothing — D-145 rule 1 evaluated live in the where clause", async () => {
    const groupA = await makeGroup("cand_lapsed_g");
    const left = await makeStudent("cand_lapsed");
    await prisma.groupMembership.create({
      data: {
        groupId: groupA,
        studentProfileId: left.studentProfileId,
        fromDate: new Date("2020-01-01T00:00:00Z"),
        toDate: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const instructorId = await makePerson("cand_lapsed_instr");
    await assignInstructorTo(groupA, instructorId);
    await grantTo({
      personId: instructorId,
      roleId: readerRoleId,
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      listStudentCandidatesForPrincipal(actorFor(instructorId)),
    ).resolves.toEqual([]);
  });

  it("a SESSION-scoped substitute is offered that lesson's EXPLICIT roster at most — the stated under-approximation", async () => {
    const groupA = await makeGroup("cand_sub_g");
    const member = await makeStudent("cand_sub_member");
    const guest = await makeStudent("cand_sub_guest");
    await placeInGroup(groupA, member.studentProfileId);
    const lesson = await makeLesson(groupA, "cand_sub");
    await addGuestRow(lesson, guest.studentProfileId);

    const substituteId = await makePerson("cand_substitute");
    await grantTo({
      personId: substituteId,
      roleId: readerRoleId,
      scopeType: "SESSION",
      scopeId: lesson,
      validUntil: new Date("2026-03-18T00:00:00.000Z"),
    });

    const offered = await listStudentCandidatesForPrincipal(
      actorFor(substituteId),
    );
    // The explicit guest row, and deliberately NOT the derived group member
    // (`student-candidate-filter.ts`'s documented narrowing) — and certainly
    // nobody outside the session.
    expect(offered.map((row) => row.studentProfileId)).toEqual([
      guest.studentProfileId,
    ]);
  });

  it("ORGANIZATION sees everyone this file made, and the name search narrows rather than widens", async () => {
    const groupA = await makeGroup("cand_org_g");
    const one = await makeStudent("cand_org_one");
    const two = await makeStudent("cand_org_two");
    await placeInGroup(groupA, one.studentProfileId);

    const adminId = await makePerson("cand_org_admin");
    await grantTo({
      personId: adminId,
      roleId: readerRoleId,
      scopeType: "ORGANIZATION",
    });

    const hit = await listStudentCandidatesForPrincipal(actorFor(adminId), {
      query: "cand_org_two",
    });
    expect(hit.map((row) => row.studentProfileId)).toEqual([
      two.studentProfileId,
    ]);
  });

  it("no student reach at all is a DENIAL, never an empty list", async () => {
    const nobodyId = await makePerson("cand_nobody");
    await expect(
      listStudentCandidatesForPrincipal(actorFor(nobodyId)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
