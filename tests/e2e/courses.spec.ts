/**
 * The `courses` module (phase 2.0) — `docs/build/phase-2.0-courses-report.md`
 * — driven through a real browser. Nothing under `tests/e2e/` exercised
 * `Course`/`CourseLevel`/`Enrolment` from the browser before this file;
 * `group-course-level.spec.ts` only proves the REVERSE link (a group's
 * `courseLevelId` field survives a save), never that a course or a level can
 * be created, or that a pupil can be enrolled, through the courses screens
 * themselves.
 *
 * Two scenarios:
 *
 *  1. A COMPLETE happy path: create a course, add a level to it, and see both
 *     on the real screens after a real navigation — the course on `/courses`,
 *     the level on the course's own detail page.
 *
 *  2. An enrolment: sign a pupil up for a course through the person page's
 *     own "Inschrijven voor een cursus" form (`enrolStudentAction`,
 *     `src/app/courses/actions.ts`, wired onto
 *     `src/app/people/[personId]/page.tsx`), see the open enrolment listed,
 *     then end it (`endEnrolmentAction`) and see it recorded as closed. No
 *     existing spec drives either action.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. MUST NOT run in the same `playwright
 * test` invocation as another spec in this directory (each truncates the
 * same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/courses.spec.ts
 */
import { expect, test } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  openDetails,
  provisionPersona,
  resetScratchDatabase,
  signInAndEnrol,
} from "./support/e2e-common";

// TWO administrator accounts, one per test — see `assessment-aftest.spec.ts`'s
// own comment on `beforeAll` for why a SHARED admin account cannot sign in
// twice from two tests in one file (MFA enrolment is one-time per account,
// D-185), and why the SECOND one is provisioned via `provision-persona.ts`'s
// `ADMIN` sentinel rather than a second `admin:create` call — the CLI refuses
// the moment a first account exists at all, enrolled or not.
const ADMIN_EMAIL = "e2e-admin-courses@example.invalid";
const ADMIN_NAME = "E2E Courses Admin";
const ADMIN2_EMAIL = "e2e-admin-courses-2@example.invalid";
const ADMIN2_NAME = "E2E Courses Admin Twee";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
});

test("compleet gelukt: cursus aanmaken, niveau toevoegen, en beide verschijnen op de echte schermen", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const courseName = `E2E Cursus ${suffix}`;
  const courseDescription = `E2E omschrijving ${suffix}`;
  const levelName = `E2E Niveau ${suffix}`;

  // --- create the course ------------------------------------------------------
  await page.goto("/courses");
  await openDetails(page, "Cursus toevoegen");
  await page.locator("#name").fill(courseName);
  await page.locator("#description").fill(courseDescription);
  await page.getByRole("button", { name: "Cursus toevoegen" }).click();

  // `createCourseAction` redirects straight to the new course's own page.
  await expect(page).toHaveURL(/\/courses\/[^/?]+$/);
  const courseUrl = page.url();

  // --- add a level to it -------------------------------------------------------
  await openDetails(page, "Niveau toevoegen");
  await page.locator("#newLevelName").fill(levelName);
  await page.getByRole("button", { name: "Niveau toevoegen" }).click();
  await expect(page).toHaveURL(/saved=level/);

  // The level's name sits inside an editable `<input>` on this row (the level
  // list doubles as an inline rename form), so its VALUE is what to check —
  // `group-course-level.spec.ts`'s own comment on why a value belongs in
  // `toHaveValue`, never `getByText`, applies here too.
  const levelNameInput = page
    .locator("table")
    .locator('input[name="name"]')
    .first();
  await expect(levelNameInput).toHaveValue(levelName);

  // --- reload from scratch: a real navigation, not client state ---------------
  await page.goto(courseUrl);
  await expect(
    page.locator("table").locator('input[name="name"]').first(),
  ).toHaveValue(levelName);

  // --- and the course itself is on the LIST, with its level counted -----------
  await page.goto("/courses");
  const courseRow = page.locator("tbody tr", {
    has: page.locator("a", { hasText: courseName }),
  });
  await expect(courseRow).toBeVisible();
  // Columns: name, description, level count, open enrolments.
  await expect(courseRow.locator("td").nth(2)).toHaveText("1");
});

test("een leerling inschrijven voor een cursus, en de inschrijving weer beëindigen", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";
  const courseName = `E2E Inschrijfcursus ${suffix}`;

  await page.goto("/courses");
  await openDetails(page, "Cursus toevoegen");
  await page.locator("#name").fill(courseName);
  await page.getByRole("button", { name: "Cursus toevoegen" }).click();
  await expect(page).toHaveURL(/\/courses\/[^/?]+$/);

  const studentFamilyName = `Inschrijfleerling${suffix}`;
  const personId = await createStudent(page, "Robin", studentFamilyName);

  // --- enrol, through the person page's own form -------------------------------
  await page.goto(`/people/${personId}`);
  await expect(
    page.getByText("Deze leerling is nergens voor ingeschreven."),
  ).toBeVisible();

  await openDetails(page, "Inschrijven voor een cursus");
  await page.locator("#enrolCourseId").selectOption({ label: courseName });
  await page.locator("#enrolStatus").selectOption({ label: "Ingeschreven" });
  // YESTERDAY, not today: the end form below defaults `endedAt` to today
  // (`toDateInputValue(new Date())`), and `Enrolment_window_order_check`
  // (`endEnrolment`, `src/modules/courses/domain/enrolment.ts`) requires
  // `endedAt > startedAt` STRICTLY — a same-day open-and-close is refused as
  // `ENDS_BEFORE_IT_STARTS`, on the exact `toDate > fromDate` reasoning
  // `src/modules/groups/domain/interval.ts` states for its own sibling check.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await page
    .locator("#enrolStartedAt")
    .fill(yesterday.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Inschrijven" }).click();
  await expect(page).toHaveURL(/saved=enrolled/);

  // --- the open enrolment is listed, with the right course and status ---------
  const enrolmentsHeading = page.getByRole("heading", {
    name: "Inschrijvingen",
    exact: true,
  });
  await expect(enrolmentsHeading).toBeVisible();
  const enrolmentRow = page
    .locator("table")
    .locator("tbody tr", { hasText: courseName });
  await expect(enrolmentRow).toBeVisible();
  await expect(enrolmentRow).toContainText("Ingeschreven");
  await expect(enrolmentRow).toContainText("loopt nog");

  // --- and it also counts on the course's own list row -------------------------
  await page.goto("/courses");
  const courseRow = page.locator("tbody tr", {
    has: page.locator("a", { hasText: courseName }),
  });
  await expect(courseRow.locator("td").nth(3)).toHaveText("1");

  // --- end the enrolment, through the SAME screen -------------------------------
  await page.goto(`/people/${personId}`);
  await openDetails(page, "Inschrijving beëindigen");
  const endRow = page.locator("li.list-group-item", { hasText: courseName });
  await endRow.getByRole("button", { name: "Beëindigen" }).click();
  await expect(page).toHaveURL(/saved=enrolmentEnded/);

  // The row still shows the course (history is never deleted, D-134), but it
  // is no longer open.
  const closedRow = page
    .locator("table")
    .locator("tbody tr", { hasText: courseName });
  await expect(closedRow).not.toContainText("loopt nog");

  await page.goto("/courses");
  await expect(courseRow.locator("td").nth(3)).toHaveText("0");
});
