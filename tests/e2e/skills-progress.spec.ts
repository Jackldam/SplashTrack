/**
 * The `skills` module's per-lesson recording screen (phase 2.1) —
 * `docs/build/phase-2.1-skills-report.md` — driven through a real browser.
 *
 * Two scenarios:
 *
 *  1. A COMPLETE, successful recording: an instructor opens the GROUP
 *     screen (`recordSkillProgress` guards `{ group: groupId }`, §2.2's own
 *     `attendance.record` example — see the file comment on
 *     `skill-progress-service.ts`), grades one criterion for a group member,
 *     sees the confirmation, and the result is visible on the pupil's own
 *     person page. The same group screen carries the criterion's
 *     `standard` — the norming/reference note phase 2.1b's catalogue import
 *     added (`Criterion.standard`, "Normering (naslag)") — proving that
 *     later-phase addition reaches this screen too.
 *
 *  2. D-145 rule 2's group-scoping refusal, from the phase 2.1 follow-up
 *     (`eecdf81`, "scope SkillProgress reads to the caller's group"): a
 *     `GROUP`-scoped instructor of a DIFFERENT group than the one an
 *     observation was recorded under —
 *
 *       a. cannot SEE it: on the pupil's own person page (reachable, because
 *          the pupil is also an active member of the instructor's OWN
 *          group — D-060, a pupil may belong to more than one group at
 *          once), the skill-progress section renders as genuinely empty,
 *          not merely trimmed — the read-side narrowing
 *          (`skillProgressFilterForReach`) working end to end through the
 *          UI, not only asserted at the service layer
 *          (`skills-scope-escape.test.ts` already does that).
 *       b. cannot CHANGE it: the group screen the observation was recorded
 *          under refuses the instructor outright (`groups.denied.title`),
 *          so the recording form is never even rendered for them to submit.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. MUST NOT run in the same `playwright
 * test` invocation as another spec in this directory (each truncates the
 * same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/skills-progress.spec.ts
 */
import { expect, test } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  grantAdditionalRole,
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
// D-185).
const ADMIN_EMAIL = "e2e-admin-skills@example.invalid";
const ADMIN_NAME = "E2E Skills Admin";
const ADMIN2_EMAIL = "e2e-admin-skills-2@example.invalid";
const ADMIN2_NAME = "E2E Skills Admin Twee";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
});

test("compleet gelukt: voortgang becijferen, bevestiging, en de normering (naslag) uit de fase 2.1b catalogus-import", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const standardText = `E2E normering ${suffix}: zoals in het diploma-boekje, kin op de borst.`;
  const { groupId, groupUrl } = await setUpCourseGroupAndSession(
    page,
    suffix,
    "Skills",
    { criterionStandard: standardText },
  );

  const studentFamilyName = `Voortgangsleerling${suffix}`;
  await createStudent(page, "Lotte", studentFamilyName);

  await page.goto(`/groups/${groupId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing voor voortgang");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // --- the normering (reference note) is on THIS screen, not only the
  //     catalogue admin screen it was authored on ---------------------------
  await openDetails(page, "Normering (naslag)");
  await expect(page.getByText(standardText)).toBeVisible();

  // --- record the observation -----------------------------------------------
  await page
    .locator("#progressStudentProfileId")
    .selectOption({ label: `Lotte ${studentFamilyName}` });
  await page
    .locator("#progressCriterionId")
    .selectOption({ label: "Kopspringen" });
  await page.locator("#progressState").selectOption({ label: "Behaald" });
  const note = `E2E: mooie kopsprong, nog even oefenen met de intap (${suffix})`;
  await page.locator("#progressNote").fill(note);
  await page.getByRole("button", { name: "Vastleggen" }).click();

  // --- the confirmation -------------------------------------------------------
  await expect(page).toHaveURL(/saved=progress/);
  await expect(
    page.getByText("Voortgang vastgelegd.", { exact: true }),
  ).toBeVisible();

  // --- and it is visible on the pupil's OWN person page -----------------------
  await page.goto("/people");
  await page
    .locator("tbody tr", {
      has: page.locator("a", { hasText: studentFamilyName }),
    })
    .locator("a")
    .click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);

  await expect(
    page.getByRole("heading", { name: "Voortgang", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Kopspringen")).toBeVisible();
  await expect(page.getByText("Behaald", { exact: true })).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();

  void groupUrl;
});

test("D-145 rule 2 (eecdf81): een instructeur buiten de groep mag voortgang niet zien en niet wijzigen", async ({
  page,
  browser,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";

  // Group A: the group the observation is actually recorded under — full
  // course/level/criteria setup.
  const { groupId: groupAId, groupUrl: groupAUrl } =
    await setUpCourseGroupAndSession(page, suffix, "SkillsScope");

  // Group B: the OUTSIDER instructor's own group — no course level needed,
  // it exists only to carry the `GROUP`-scoped grant and an active
  // `InstructorAssignment`, the two things `resolveReach` requires together
  // for a `GROUP` reach to resolve at all.
  const groupBName = `E2E SkillsScope Groep B ${suffix}`;
  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupBName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupBId = page.url().match(/\/groups\/([^/?]+)/)![1]!;

  // The pupil belongs to BOTH groups (D-060) — the exact shape that makes
  // this a genuine narrowing test rather than an ordinary access refusal:
  // the outsider instructor CAN reach the pupil's person page (through their
  // own group B membership), and the question is whether they see the row
  // recorded under group A.
  const studentFamilyName = `Scopeleerling${suffix}`;
  const studentPersonId = await createStudent(page, "Fien", studentFamilyName);

  await page.goto(`/groups/${groupAId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing groep A");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  await page.goto(`/groups/${groupBId}`);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page.locator("#placeReason").fill("E2E: plaatsing groep B");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // Record the observation under group A, as admin.
  await page.goto(groupAUrl);
  await page
    .locator("#progressStudentProfileId")
    .selectOption({ label: `Fien ${studentFamilyName}` });
  await page
    .locator("#progressCriterionId")
    .selectOption({ label: "Kopspringen" });
  await page.locator("#progressState").selectOption({ label: "Behaald" });
  const note = `E2E: alleen zichtbaar voor groep A (${suffix})`;
  await page.locator("#progressNote").fill(note);
  await page.getByRole("button", { name: "Vastleggen" }).click();
  await expect(page).toHaveURL(/saved=progress/);

  // --- the outsider instructor: `GROUP`-scoped to group B ONLY for
  //     `skills.read`/`groups.read` (this is the reach that must narrow),
  //     plus a SEPARATE `ORGANIZATION`-scoped grant of `people.read` — the
  //     only way to open `/people/[personId]` at all, since a `GROUP` reach
  //     never covers a bare `{ person }` ref (`grantAdditionalRole`'s own
  //     header explains why two grants are needed here) --------------------
  const instructorPassword = "E2eTestPassw0rd!2026scope";
  const instructor = provisionPersona(
    `e2e-skills-outsider-${suffix}@example.invalid`,
    "Buitengroep Instructeur",
    instructorPassword,
    ["skills.read", "groups.read"],
    { scopeType: "GROUP", scopeId: groupBId },
  );
  grantAdditionalRole(instructor.personId, ["people.read"]);

  // The InstructorAssignment `resolveReach` requires alongside the
  // RoleAssignment above — assigned through the real screen, as admin.
  await page.goto(`/groups/${groupBId}`);
  await openDetails(page, "Lesgever toewijzen");
  await page.locator("#personId").fill(instructor.personId);
  await page.getByRole("button", { name: "Lesgever toewijzen" }).click();
  await expect(page).toHaveURL(/saved=instructor/);

  const instructorContext = await browser.newContext();
  const instructorPage = await instructorContext.newPage();
  await signInAndEnrol(instructorPage, instructor.email, instructorPassword);

  // --- (a) CANNOT SEE: the pupil's own person page, reachable through group
  //     B membership, shows no progress at all — the group-A row is
  //     narrowed away, not merely inaccessible wholesale ----------------------
  await instructorPage.goto(`/people/${studentPersonId}`);
  await expect(
    instructorPage.getByRole("heading", { name: "Voortgang", exact: true }),
  ).toBeVisible();
  await expect(
    instructorPage.getByText(
      "Er is nog geen voortgang vastgelegd voor deze leerling.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(instructorPage.getByText(note)).toHaveCount(0);

  // --- (b) CANNOT CHANGE: group A's own screen refuses this instructor
  //     outright — the recording form never renders for them to submit -------
  await instructorPage.goto(groupAUrl);
  await expect(
    instructorPage.getByRole("heading", { name: "Geen toegang" }),
  ).toBeVisible();
  await expect(instructorPage.locator("#progressStudentProfileId")).toHaveCount(
    0,
  );

  await instructorContext.close();
});
