/**
 * The `assessment` module (phase 2.3), driven through a real browser —
 * `docs/build/phase-2.3-assessment-report.md`.
 *
 * Two scenarios, matching the report's own §1.1/§1.10:
 *
 *  1. A COMPLETE, successful aftest: an independent assessor grades every
 *     criterion for a group member, fills the unprotected sitting-level
 *     remark (visible with NO `students.notes.*` grant — §1.5), sees the
 *     confirmation, and the result is visible on the pupil's own person page.
 *     The SAME screen then proves the phase 2.2 decision-round's one guest
 *     mechanism (`docs/build/phase-2.2-attendance-report.md` §1.4) reaches
 *     the aftest form too: a guest added to the lesson's roster is offered in
 *     the "pick a pupil" select next to every ordinary group member, and an
 *     aftest can be recorded for them the same way.
 *
 *  2. D-085's write-time independence refusal (§1.1 of the same report): an
 *     instructor who currently holds the group's `InstructorAssignment` — and
 *     holds `assessment.record` but NOT `assessment.independence.override` —
 *     tries to grade their OWN pupil. Refused with `NOT_INDEPENDENT`, shown as
 *     a real `alert-danger` on the lesson screen, not merely a service-layer
 *     exception.
 *
 * The phase 2.2 decision round's GUEST scenario is the only fase-2.2-decision-round
 * item that touches this screen at all (`docs/build/phase-2.2-attendance-report.md`
 * §1.4 — the roster IS the boundary the aftest's own "pick a pupil" `<select>`
 * reads from, `lesson.roster`, guests included). D-085's exams-side OVERRIDE
 * UI step does not live on this screen — see `exams-candidate-confirm.spec.ts`.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure (`tests/e2e/support/e2e-common.ts`) and this worktree's own
 * dedicated `splashtrack_scratch_e2e_wt_attendance` database (`.env.e2e`) —
 * see that file's header for why. Provisioning a RESTRICTED, non-administrator
 * account (the independent assessor, the own-instructor) is not something any
 * screen in this build can do (no `/roles` or `/users` route exists yet) —
 * `tests/e2e/support/provision-persona.ts` does it the same way the phase
 * reports' own browser verification did, from a throwaway script.
 *
 * Run alone: `npx playwright test tests/e2e/assessment-aftest.spec.ts`.
 */
import { expect, test } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  openDetails,
  pickFromLiveSearch,
  provisionPersona,
  resetScratchDatabase,
  setUpCourseGroupAndSession,
  signInAndEnrol,
} from "./support/e2e-common";

// TWO administrator accounts, one per test — `admin:create` refuses once
// setup completes (the first account's own MFA enrolment), but allows
// creating several accounts BEFORE any of them enrols (the CLI's own
// documented "NOTE: ... account(s) already exist and setup is not complete"
// case). Both are created here, in `beforeAll`, before either test's browser
// enrols one of them — the D-185 one-time-secret constraint otherwise makes
// a SHARED admin account impossible to sign into twice from two tests in one
// file (the second attempt lands on the ordinary TOTP code prompt, not
// `/mfa-enrolment`, because the account is no longer `mfa_pending`).
const ADMIN_EMAIL = "e2e-admin-assessment@example.invalid";
const ADMIN_NAME = "E2E Assessment Admin";
const ADMIN2_EMAIL = "e2e-admin-assessment-2@example.invalid";
const ADMIN2_NAME = "E2E Assessment Admin Twee";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  // NOT `createAdmin` again — the CLI refuses a second `admin:create` the
  // moment the first account exists (`PENDING_ENROLMENT` is not a state the
  // command tolerates, unlike its own comment about "several accounts before
  // enrolment" suggests; that path is unreachable in practice). The second
  // admin is provisioned the same way the restricted personas are, with the
  // `ADMIN` sentinel — see `provision-persona.ts`'s own comment.
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
});

test("compleet gelukt aftest, de onbeschermde zitting-opmerking, en het gastenmechanisme uit de fase 2.2 decision round", async ({
  page,
  browser,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const { groupId, sessionUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Aftest",
  );

  const studentFamilyName = `Aftestleerling${suffix}`;
  await createStudent(page, "Eva", studentFamilyName);

  // Place the pupil in the group — an ordinary, non-guest roster member.
  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing voor de aftest");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // The guest pupil — deliberately NEVER placed in any group, the trial-
  // swimmer shape D-179/§1.4 names: a `StudentProfile` needs no membership.
  const guestFamilyName = `Aftestgast${suffix}`;
  await createStudent(page, "Fenna", guestFamilyName);

  // --- provision the independent assessor -----------------------------------
  // `planning.read` to open the lesson screen at all (`getSessionForPrincipal`),
  // `assessment.read`/`.record` for the aftest itself. Deliberately NOT
  // `assessment.independence.override` and NOT `students.notes.write` —
  // §1.5's whole point is that the sitting-level remark needs neither.
  const assessorPassword = "E2eTestPassw0rd!2026assessor";
  const assessor = provisionPersona(
    `e2e-assessor-independent-${suffix}@example.invalid`,
    "Onafhankelijke Beoordelaar",
    assessorPassword,
    ["planning.read", "assessment.read", "assessment.record"],
  );

  // Add the guest to the lesson's roster, as admin — `groups.assign_members`
  // OR `attendance.record` opens this (the decision round's widened guard);
  // an org administrator holds both.
  await page.goto(sessionUrl);
  await openDetails(
    page,
    "Gast toevoegen (inhaalles, andere groep of proefzwemmer)",
  );
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    guestFamilyName,
    new RegExp(guestFamilyName),
  );
  await page.locator("#guestReason").fill("E2E: proefzwemmer voor de aftest");
  await page.getByRole("button", { name: "Gast toevoegen" }).click();
  await expect(page).toHaveURL(/saved=guest/);
  await expect(
    page.getByRole("row", { name: new RegExp(guestFamilyName) }).first(),
  ).toBeVisible();

  // --- sign in as the independent assessor, in a SEPARATE browser context --
  const assessorContext = await browser.newContext();
  const assessorPage = await assessorContext.newPage();
  await signInAndEnrol(assessorPage, assessor.email, assessorPassword);
  await assessorPage.goto(sessionUrl);

  await expect(assessorPage.getByText("Aftest", { exact: true })).toBeVisible();

  // Both the ordinary group member AND the guest are offered — the guest
  // mechanism reaching this screen, per this file's own header.
  const studentSelect = assessorPage.locator("#assessStudent");
  await expect(
    studentSelect.locator("option", { hasText: studentFamilyName }),
  ).toHaveCount(1);
  await expect(
    studentSelect.locator("option", { hasText: guestFamilyName }),
  ).toHaveCount(1);

  // The sitting-level remark textarea is visible and fillable RIGHT NOW,
  // with NO `students.notes.*` grant on this account at all (§1.5).
  const remarkField = assessorPage.locator("#assessRemark");
  await expect(remarkField).toBeVisible();

  // --- record the ordinary member's aftest: grade the one criterion ---------
  await studentSelect.selectOption({ label: `Eva ${studentFamilyName}` });
  const gradeSelect = assessorPage.locator('select[name^="grade_"]').first();
  await gradeSelect.selectOption({ label: "Voldoende" });
  const sittingRemark = `E2E: goede kopsprong, nog wat sneller instappen (${suffix})`;
  await remarkField.fill(sittingRemark);
  await assessorPage.getByRole("button", { name: "Aftest vastleggen" }).click();

  await expect(assessorPage).toHaveURL(/saved=assessment/);
  await expect(
    assessorPage.getByText("Aftest vastgelegd.", { exact: true }),
  ).toBeVisible();

  // --- the result is visible on the pupil's OWN person page -----------------
  const studentRow = page.locator("tbody tr", {
    has: page.locator("a", { hasText: studentFamilyName }),
  });
  await page.goto("/people");
  await studentRow.locator("a").click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);

  await expect(page.getByRole("heading", { name: "Aftesten" })).toBeVisible();
  await expect(page.getByText("Geslaagd", { exact: true })).toBeVisible();
  await expect(page.getByText(sittingRemark)).toBeVisible();

  // --- the guest's aftest works through the SAME form, same screen ----------
  await assessorPage.goto(sessionUrl);
  await assessorPage
    .locator("#assessStudent")
    .selectOption({ label: `Fenna ${guestFamilyName}` });
  await assessorPage
    .locator('select[name^="grade_"]')
    .first()
    .selectOption({ label: "Voldoende" });
  await assessorPage.getByRole("button", { name: "Aftest vastleggen" }).click();
  await expect(assessorPage).toHaveURL(/saved=assessment/);

  await assessorContext.close();
});

test("D-085: een instructeur mag zijn eigen leerling niet aftekenen zonder de onafhankelijkheids-uitzondering", async ({
  page,
  browser,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";
  const { groupId, sessionUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Aftest",
  );

  const studentFamilyName = `EigenLeerling${suffix}`;
  await createStudent(page, "Timo", studentFamilyName);

  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing voor de weigering");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // The instructor: `assessment.record`, but deliberately NOT
  // `assessment.independence.override` — the exact permission set D-085's
  // write-time check (`recordAssessment`, assessment-service.ts) is proven
  // against.
  const instructorPassword = "E2eTestPassw0rd!2026instr";
  const instructor = provisionPersona(
    `e2e-own-instructor-${suffix}@example.invalid`,
    "Eigen Instructeur",
    instructorPassword,
    ["planning.read", "assessment.read", "assessment.record"],
  );

  // Assign them as the group's own instructor, as admin.
  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Lesgever toewijzen");
  await page.locator("#personId").fill(instructor.personId);
  await page.getByRole("button", { name: "Lesgever toewijzen" }).click();
  await expect(page).toHaveURL(/saved=instructor/);

  const instructorContext = await browser.newContext();
  const instructorPage = await instructorContext.newPage();
  await signInAndEnrol(instructorPage, instructor.email, instructorPassword);
  await instructorPage.goto(sessionUrl);

  await instructorPage
    .locator("#assessStudent")
    .selectOption({ label: `Timo ${studentFamilyName}` });
  await instructorPage
    .locator('select[name^="grade_"]')
    .first()
    .selectOption({ label: "Voldoende" });
  await instructorPage
    .getByRole("button", { name: "Aftest vastleggen" })
    .click();

  // REFUSED — visibly, on the screen, not merely at the service layer: a
  // real `alert-danger` naming NOT_INDEPENDENT, and the URL carries the
  // error code the same way every other module's refusal does on this page.
  await expect(instructorPage).toHaveURL(/error=NOT_INDEPENDENT/);
  await expect(instructorPage.locator(".alert-danger")).toContainText(
    "De beoordelaar is de eigen instructeur van deze leerling",
  );

  // And no `Assessment` row reached the pupil's own history — the refusal is
  // real, not a form that silently ate its own submission.
  const studentRow = page.locator("tbody tr", {
    has: page.locator("a", { hasText: studentFamilyName }),
  });
  await page.goto("/people");
  await studentRow.locator("a").click();
  await expect(
    page.getByText("Er is nog geen aftest vastgelegd", { exact: false }),
  ).toBeVisible();

  await instructorContext.close();
});
