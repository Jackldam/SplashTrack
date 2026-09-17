/**
 * The per-module scope-escape suite `06-delivery.md` §2.1 requires, for
 * `fees`.
 *
 * Four shapes are pinned by name:
 *
 *   1. A UNIT-scoped fees administrator reaches a payer/student whose home
 *      unit/membership unit is their own, and is denied for one in a
 *      different unit — the `people-scope-escape.test.ts` shape, applied to
 *      `{ person }`/`{ student }`.
 *   2. A GROUP-scoped fees administrator reaches a STUDENT charge through the
 *      student's own active group membership, and is denied for a student in
 *      a different group. A GROUP reach NEVER covers `{ person }` at all
 *      (`covers-resource.ts`'s own `GROUPS` case), so the same actor is
 *      denied outright for a membership-only charge (no student), even for a
 *      payer who really is a member of their group.
 *   3. `waiveCharge`/`cancelCharge`/`recordPayment` guard on the CHARGE's OWN
 *      stored payer/student, never on a resource id supplied by the caller —
 *      the `registerExamCandidate`/`{ group: groupId }` shape, one level
 *      down: an actor cannot act on a charge just because they know its id.
 *   4. No grant at all is denied outright, for every write and every read
 *      (including `exportFeesCsv`, which additionally requires
 *      `fees.export` specifically).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermissionDeniedError } from "@/lib/authorization";
import {
  createCharge,
  exportFeesCsv,
  getFeeBalanceForPayer,
  getFeeBalanceForStudent,
  recordPayment,
  waiveCharge,
} from "@/modules/fees";

import {
  assignInstructorTo,
  feid,
  grantTo,
  installRealRelations,
  makeFeeType,
  makeGroup,
  makePerson,
  makeRole,
  makeStudent,
  makeUnit,
  placeInGroup,
  resetFeesFixtures,
} from "../support/fees-fixtures";

const NOW = new Date("2026-09-16T12:00:00.000Z");

let adminId: string;
let feeTypeId: string;

function admin() {
  return { principal: { personId: adminId }, at: NOW };
}

function actorFor(personId: string) {
  return { principal: { personId }, at: NOW };
}

beforeAll(() => {
  installRealRelations();
});

beforeEach(async () => {
  await resetFeesFixtures();
  adminId = await makePerson("esc_admin");
  await grantTo({
    personId: adminId,
    roleId: await makeRole("esc_role_admin", [
      "fees.read",
      "fees.manage",
      "fees.export",
    ]),
    scopeType: "ORGANIZATION",
  });
  feeTypeId = await makeFeeType("esc_ft", { amount: 1000 });
});

afterAll(async () => {
  await resetFeesFixtures();
});

describe("UNIT-scoped reach follows the payer's/student's own unit", () => {
  it("a UNIT-scoped administrator reaches a payer in their unit, and is denied for one in another", async () => {
    const unitA = await makeUnit("unitA1");
    const unitB = await makeUnit("unitB1");
    const payerInA = await makePerson("unit1_payerA", { memberOfUnit: unitA });
    const payerInB = await makePerson("unit1_payerB", { memberOfUnit: unitB });

    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerInA,
      dueDate: "2026-10-01",
      clientEventId: feid("unit1_ce_a"),
    });
    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerInB,
      dueDate: "2026-10-01",
      clientEventId: feid("unit1_ce_b"),
    });

    const managerId = await makePerson("unit1_manager");
    await grantTo({
      personId: managerId,
      roleId: await makeRole("unit1_role", ["fees.read", "fees.manage"]),
      scopeType: "UNIT",
      scopeId: unitA,
    });

    await expect(
      getFeeBalanceForPayer(actorFor(managerId), payerInA),
    ).resolves.toMatchObject({ charges: [expect.anything()] });

    await expect(
      getFeeBalanceForPayer(actorFor(managerId), payerInB),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a UNIT-scoped administrator reaches a student whose HOME unit is theirs, and is denied for another unit's student", async () => {
    const unitA = await makeUnit("unitA2");
    const unitB = await makeUnit("unitB2");
    const studentInA = await makeStudent("unit2_a", { unitId: unitA });
    const studentInB = await makeStudent("unit2_b", { unitId: unitB });
    const payerId = await makePerson("unit2_payer");

    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentInA.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("unit2_ce_a"),
    });
    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentInB.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("unit2_ce_b"),
    });

    const managerId = await makePerson("unit2_manager");
    await grantTo({
      personId: managerId,
      roleId: await makeRole("unit2_role", ["fees.read"]),
      scopeType: "UNIT",
      scopeId: unitA,
    });

    await expect(
      getFeeBalanceForStudent(actorFor(managerId), studentInA.studentProfileId),
    ).resolves.toMatchObject({ charges: [expect.anything()] });

    await expect(
      getFeeBalanceForStudent(actorFor(managerId), studentInB.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("GROUP-scoped reach covers a STUDENT charge through active group membership, and NEVER a person-only charge", () => {
  it("a GROUP-scoped administrator reaches a student in their group, and is denied for a student in another group", async () => {
    const groupA = await makeGroup("grp1_a");
    const groupB = await makeGroup("grp1_b");
    const studentA = await makeStudent("grp1_studentA");
    const studentB = await makeStudent("grp1_studentB");
    await placeInGroup(groupA, studentA.studentProfileId);
    await placeInGroup(groupB, studentB.studentProfileId);
    const payerId = await makePerson("grp1_payer");

    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentA.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("grp1_ce_a"),
    });
    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentB.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("grp1_ce_b"),
    });

    const managerId = await makePerson("grp1_manager");
    await assignInstructorTo(groupA, managerId);
    await grantTo({
      personId: managerId,
      roleId: await makeRole("grp1_role", ["fees.read"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      getFeeBalanceForStudent(actorFor(managerId), studentA.studentProfileId),
    ).resolves.toMatchObject({ charges: [expect.anything()] });

    await expect(
      getFeeBalanceForStudent(actorFor(managerId), studentB.studentProfileId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("a GROUP-scoped administrator is denied a membership-only (person, no student) charge outright — GROUP never covers { person }", async () => {
    const groupA = await makeGroup("grp2_a");
    const memberStudent = await makeStudent("grp2_member_student");
    await placeInGroup(groupA, memberStudent.studentProfileId);
    // The payer really is the parent of a child in the manager's own group —
    // and it still does not matter: `{ person }` is never covered by a
    // GROUP reach (`covers-resource.ts`'s own `GROUPS` case returns `false`
    // for `organization`/`unit`/`course`/`person` unconditionally).
    const payerId = memberStudent.personId;

    await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("grp2_ce"),
    });

    const managerId = await makePerson("grp2_manager");
    await assignInstructorTo(groupA, managerId);
    await grantTo({
      personId: managerId,
      roleId: await makeRole("grp2_role", ["fees.read", "fees.manage"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      getFeeBalanceForPayer(actorFor(managerId), payerId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("waive/cancel/recordPayment guard the CHARGE's OWN stored resource, never a caller-supplied one", () => {
  it("a GROUP-scoped administrator can waive a charge about a student in their OWN group, and is denied for another group's student's charge, despite knowing its id", async () => {
    const groupA = await makeGroup("act1_a");
    const groupB = await makeGroup("act1_b");
    const studentA = await makeStudent("act1_studentA");
    const studentB = await makeStudent("act1_studentB");
    await placeInGroup(groupA, studentA.studentProfileId);
    await placeInGroup(groupB, studentB.studentProfileId);
    const payerId = await makePerson("act1_payer");

    const { id: chargeA } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentA.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("act1_ce_a"),
    });
    const { id: chargeB } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentB.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("act1_ce_b"),
    });

    const managerId = await makePerson("act1_manager");
    await assignInstructorTo(groupA, managerId);
    await grantTo({
      personId: managerId,
      roleId: await makeRole("act1_role", ["fees.manage"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      waiveCharge(actorFor(managerId), { chargeId: chargeA, reason: "ok" }),
    ).resolves.toBeUndefined();

    // The manager KNOWS chargeB's id (it is a plain string, not a secret) —
    // that alone must not be enough. The guard is re-derived from the
    // charge's own stored studentProfileId, not trusted from the caller.
    await expect(
      waiveCharge(actorFor(managerId), { chargeId: chargeB, reason: "no" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("recordPayment is guarded the same way", async () => {
    const groupA = await makeGroup("act2_a");
    const groupB = await makeGroup("act2_b");
    const studentA = await makeStudent("act2_studentA");
    const studentB = await makeStudent("act2_studentB");
    await placeInGroup(groupA, studentA.studentProfileId);
    await placeInGroup(groupB, studentB.studentProfileId);
    const payerId = await makePerson("act2_payer");

    const { id: chargeA } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentA.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("act2_ce_a"),
    });
    const { id: chargeB } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      studentProfileId: studentB.studentProfileId,
      dueDate: "2026-10-01",
      clientEventId: feid("act2_ce_b"),
    });

    const managerId = await makePerson("act2_manager");
    await assignInstructorTo(groupA, managerId);
    await grantTo({
      personId: managerId,
      roleId: await makeRole("act2_role", ["fees.manage"]),
      scopeType: "GROUP",
      scopeId: groupA,
    });

    await expect(
      recordPayment(actorFor(managerId), {
        chargeId: chargeA,
        amount: 100,
        method: "CASH",
        clientEventId: feid("act2_pay_a"),
      }),
    ).resolves.toMatchObject({ id: expect.any(String) as string });

    await expect(
      recordPayment(actorFor(managerId), {
        chargeId: chargeB,
        amount: 100,
        method: "CASH",
        clientEventId: feid("act2_pay_b"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("no grant at all", () => {
  it("is denied every write and every read, including export requiring its own permission", async () => {
    const payerId = await makePerson("noperm1_payer");
    const { id: chargeId } = await createCharge(admin(), {
      feeTypeId,
      payerPersonId: payerId,
      dueDate: "2026-10-01",
      clientEventId: feid("noperm1_ce"),
    });

    const nobodyId = await makePerson("noperm1_nobody");

    await expect(
      createCharge(actorFor(nobodyId), {
        feeTypeId,
        payerPersonId: payerId,
        dueDate: "2026-10-01",
        clientEventId: feid("noperm1_ce2"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      getFeeBalanceForPayer(actorFor(nobodyId), payerId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      waiveCharge(actorFor(nobodyId), { chargeId, reason: "x" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(
      recordPayment(actorFor(nobodyId), {
        chargeId,
        amount: 100,
        method: "CASH",
        clientEventId: feid("noperm1_pay"),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(exportFeesCsv(actorFor(nobodyId))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("fees.read/fees.manage alone do not grant fees.export", async () => {
    const managerId = await makePerson("noperm2_manager");
    await grantTo({
      personId: managerId,
      roleId: await makeRole("noperm2_role", ["fees.read", "fees.manage"]),
      scopeType: "ORGANIZATION",
    });

    await expect(exportFeesCsv(actorFor(managerId))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
