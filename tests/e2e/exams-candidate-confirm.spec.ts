/**
 * The `exams` module (phase 2.4), driven through a real browser —
 * `docs/build/phase-2.4-exams-report.md`.
 *
 * Two scenarios, matching the report's own §1.1/§1.8:
 *
 *  1. A COMPLETE, successful confirmation: register a candidacy against a
 *     student with a genuinely qualifying aftest (an independent, qualified
 *     assessor's recorded PASS), confirm it with NO override needed, record a
 *     PASS exam result, and issue the diploma (`Award`) — visible on the
 *     screen with its own number.
 *
 *  2. D-085's full formula, checked live at confirmation time, and its
 *     override: an assessor who is the candidate's OWN instructor grades a
 *     PASS aftest (permitted only because THEY hold
 *     `assessment.independence.override` — the assessment phase's own
 *     write-time exception, D-085 §1.1 of the phase 2.3 report). Confirming
 *     the candidacy WITHOUT an override reason is refused — `NOT_INDEPENDENT`,
 *     RE-VERIFIED LIVE by `exams` itself, never trusting assessment's own
 *     write-time decision (phase 2.4 report §1.1). Confirming AGAIN, this
 *     time with a typed override reason, succeeds — `exams.candidacy.override`
 *     — and the candidacy renders the "Uitzondering toegepast" badge. This is
 *     the one D-085 override step that DOES have a UI step (the
 *     `overrideReason` field on the confirm form, `src/app/exams/actions.ts`
 *     `confirmExamCandidateAction`) — unlike `assessment-aftest.spec.ts`,
 *     which found none on the aftest screen itself.
 *
 * `grantQualificationAction` (`src/app/exams/actions.ts`) exists in the code
 * but is wired to NO form anywhere in `src/app` — there is no browser-reachable
 * way to grant a `PersonQualification` in this build. Both scenarios below
 * grant it directly (`tests/e2e/support/provision-persona.ts`'s
 * `grant-qualification` command, the same throwaway-script pattern the phase
 * report's own browser verification used) and this gap is flagged again in
 * the e2e report this spec belongs to, not silently routed around.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts` and `assessment-aftest.spec.ts`'s own
 * header for why. MUST NOT run in the same `playwright test` invocation as
 * another spec in this directory (each truncates the same scratch database
 * in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/exams-candidate-confirm.spec.ts
 */
import { expect, test } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  grantQualification,
  openDetails,
  pickFromLiveSearch,
  provisionPersona,
  resetScratchDatabase,
  setUpCourseGroupAndSession,
  signInAndEnrol,
} from "./support/e2e-common";

// TWO administrator accounts, one per test — see `assessment-aftest.spec.ts`'s
// own comment on `beforeAll` for why a SHARED admin account cannot sign in
// twice from two tests in one file (MFA enrolment is one-time per account,
// D-185) and why the second one is provisioned via `provision-persona.ts`'s
// `ADMIN` sentinel rather than a second `admin:create` call.
const ADMIN_EMAIL = "e2e-admin-exams@example.invalid";
const ADMIN_NAME = "E2E Exams Admin";
const ADMIN2_EMAIL = "e2e-admin-exams-2@example.invalid";
const ADMIN2_NAME = "E2E Exams Admin Twee";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
});

test("compleet gelukt: registratie, bevestiging zonder uitzondering, resultaat, en het diploma", async ({
  page,
  browser,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const { awardName, groupId, sessionUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Exams",
  );

  const studentFamilyName = `Examenkandidaat${suffix}`;
  const studentPersonId = await createStudent(page, "Sanne", studentFamilyName);

  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing voor het examen");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // --- the independent, qualified assessor ----------------------------------
  // NOT the group's instructor (independence holds without an override), and
  // holds a `PersonQualification` valid at the moment they assess — D-085's
  // second and third clauses, both real requirements `exams`' own confirm
  // checks (phase 2.4 report §1.1).
  const assessorPassword = "E2eTestPassw0rd!2026assessor";
  const assessor = provisionPersona(
    `e2e-exams-assessor-${suffix}@example.invalid`,
    "Gekwalificeerde Beoordelaar",
    assessorPassword,
    ["planning.read", "assessment.read", "assessment.record"],
  );
  grantQualification(assessor.personId, "ZWEMBOND_INSTRUCTEUR");

  const assessorContext = await browser.newContext();
  const assessorPage = await assessorContext.newPage();
  await signInAndEnrol(assessorPage, assessor.email, assessorPassword);
  await assessorPage.goto(sessionUrl);

  await assessorPage
    .locator("#assessStudent")
    .selectOption({ label: `Sanne ${studentFamilyName}` });
  await assessorPage
    .locator('select[name^="grade_"]')
    .first()
    .selectOption({ label: "Voldoende" });
  await assessorPage.getByRole("button", { name: "Aftest vastleggen" }).click();
  await expect(assessorPage).toHaveURL(/saved=assessment/);
  await assessorContext.close();

  // --- register the candidacy, as admin -------------------------------------
  await page.goto(`/people/${studentPersonId}`);
  await page
    .locator('select[name="awardTypeId"]')
    .selectOption({ label: awardName });
  await page.locator('select[name="groupId"]').selectOption({ value: groupId });
  await page.getByRole("button", { name: "Registreer kandidaat" }).click();
  await expect(page).toHaveURL(/saved=examCandidateRegistered/);
  await expect(page.getByText("In afwachting")).toBeVisible();

  // --- confirm it: D-085's full formula passes, no override needed ----------
  await page.getByRole("button", { name: "Bevestig kandidaat" }).click();
  await expect(page).toHaveURL(/saved=examCandidateConfirmed/);
  await expect(page.getByText("Bevestigd", { exact: true })).toBeVisible();
  // No override badge — the confirmation needed none.
  await expect(page.getByText("Uitzondering toegepast")).toHaveCount(0);

  // --- record a PASS exam result ---------------------------------------------
  await page
    .locator('select[name="outcome"]')
    .selectOption({ label: "Geslaagd" });
  await page.getByRole("button", { name: "Leg resultaat vast" }).click();
  await expect(page).toHaveURL(/saved=examResultRecorded/);

  // --- issue the diploma -----------------------------------------------------
  const awardNumber = `E2E-DIPLOMA-${suffix}`;
  await page.locator('input[name="number"]').fill(awardNumber);
  await page.getByRole("button", { name: "Reik uit" }).click();
  await expect(page).toHaveURL(/saved=awardIssued/);
  await expect(page.getByText(awardNumber, { exact: true })).toBeVisible();
});

test("D-085 volledig geverifieerd bij bevestiging: geweigerd zonder uitzondering, bevestigd met de uitzondering", async ({
  page,
  browser,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";
  const { awardName, groupId, sessionUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Exams",
  );

  const studentFamilyName = `NietOnafhankelijk${suffix}`;
  const studentPersonId = await createStudent(page, "Jesse", studentFamilyName);

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

  // The assessor: the group's OWN instructor, holding
  // `assessment.independence.override` (so recording the aftest itself
  // succeeds, per the assessment phase's own write-time exception) and a
  // valid `PersonQualification` — every D-085 clause holds EXCEPT
  // independence, by construction.
  const assessorPassword = "E2eTestPassw0rd!2026notind";
  const assessor = provisionPersona(
    `e2e-exams-not-independent-${suffix}@example.invalid`,
    "Eigen Instructeur Examenkant",
    assessorPassword,
    [
      "planning.read",
      "assessment.read",
      "assessment.record",
      "assessment.independence.override",
    ],
  );
  grantQualification(assessor.personId, "ZWEMBOND_INSTRUCTEUR");

  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Lesgever toewijzen");
  await page.locator("#personId").fill(assessor.personId);
  await page.getByRole("button", { name: "Lesgever toewijzen" }).click();
  await expect(page).toHaveURL(/saved=instructor/);

  const assessorContext = await browser.newContext();
  const assessorPage = await assessorContext.newPage();
  await signInAndEnrol(assessorPage, assessor.email, assessorPassword);
  await assessorPage.goto(sessionUrl);

  await assessorPage
    .locator("#assessStudent")
    .selectOption({ label: `Jesse ${studentFamilyName}` });
  await assessorPage
    .locator('select[name^="grade_"]')
    .first()
    .selectOption({ label: "Voldoende" });
  await assessorPage.getByRole("button", { name: "Aftest vastleggen" }).click();
  // Succeeds — assessment's OWN write-time override, proven separately in
  // `assessment-aftest.spec.ts`.
  await expect(assessorPage).toHaveURL(/saved=assessment/);
  await assessorContext.close();

  // --- register the candidacy, as admin -------------------------------------
  await page.goto(`/people/${studentPersonId}`);
  await page
    .locator('select[name="awardTypeId"]')
    .selectOption({ label: awardName });
  await page.locator('select[name="groupId"]').selectOption({ value: groupId });
  await page.getByRole("button", { name: "Registreer kandidaat" }).click();
  await expect(page).toHaveURL(/saved=examCandidateRegistered/);

  // --- confirm WITHOUT an override reason: refused, visibly ------------------
  // Exactly one PENDING candidacy is on this page, so exactly one confirm
  // form/button exists.
  await page.getByRole("button", { name: "Bevestig kandidaat" }).click();

  await expect(page).toHaveURL(/error=NOT_INDEPENDENT/);
  await expect(page.locator(".alert-danger")).toContainText(
    "De beoordelaar van de aftest is de eigen instructeur van deze leerling",
  );
  // Still PENDING — the refusal is real, not a silent partial confirmation.
  await expect(page.getByText("In afwachting")).toBeVisible();

  // --- confirm AGAIN, this time with a typed override reason: succeeds -------
  await page
    .locator('input[name="overrideReason"]')
    .fill("E2E: uitzondering, beoordelaar is eigen instructeur (D-085)");
  await page.getByRole("button", { name: "Bevestig kandidaat" }).click();

  await expect(page).toHaveURL(/saved=examCandidateConfirmed/);
  await expect(page.getByText("Bevestigd", { exact: true })).toBeVisible();
  await expect(page.getByText("Uitzondering toegepast")).toBeVisible();
});
