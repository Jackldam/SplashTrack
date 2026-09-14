/**
 * The `groups` module's own write paths that no existing spec exercises for
 * their own sake — `src/app/groups/actions.ts`'s `assignInstructorAction` and
 * `moveStudentAction`. Both already run, incidentally, inside other specs
 * (`assessment-aftest.spec.ts` assigns an instructor to prove D-085's
 * independence refusal; `placeStudentAction`+the live-search picker is set up
 * by every attendance/assessment/exams/skills spec as ordinary scaffolding),
 * but nothing asserts on the ASSIGNMENT or the MOVE as the point of a test.
 * This file does.
 *
 * `placeStudentAction`'s own live-search picker is DELIBERATELY NOT re-tested
 * as its own scenario here: it is exercised, and already asserted on
 * (`saved=placed`), by every one of `assessment-aftest.spec.ts`,
 * `exams-candidate-confirm.spec.ts`, `skills-progress.spec.ts` and
 * `attendance-register.spec.ts` — the exact mechanism this file's first test
 * still needs as setup for the instructor assignment, and this file's second
 * test needs as setup for the move. Driving it again as a dedicated scenario
 * would only duplicate that coverage. Course-level fields on the group screen
 * are `group-course-level.spec.ts`'s own subject and are not repeated here.
 *
 * Two scenarios:
 *
 *  1. Create a group, place a pupil in it (the picker, as scaffolding), and
 *     assign an instructor (`assignInstructorAction`) — both show up on the
 *     group's own screen after a real reload.
 *
 *  2. Move a pupil from one group to another (`moveStudentAction` — ONE
 *     action for all three directions, per that file's own comment): the
 *     pupil leaves the source group's roster and appears on the
 *     destination's.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. MUST NOT run in the same `playwright
 * test` invocation as another spec in this directory (each truncates the
 * same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/groups-lifecycle.spec.ts
 */
import { expect, test } from "@playwright/test";

import {
  assertNoAccessibilityViolations,
  createAdmin,
  createStudent,
  openDetails,
  pickFromLiveSearch,
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
const ADMIN_EMAIL = "e2e-admin-groups-lifecycle@example.invalid";
const ADMIN_NAME = "E2E Groups Lifecycle Admin";
const ADMIN2_EMAIL = "e2e-admin-groups-lifecycle-2@example.invalid";
const ADMIN2_NAME = "E2E Groups Lifecycle Admin Twee";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
});

test("een groep aanmaken, een leerling plaatsen via de live-search picker, en een lesgever toewijzen", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  await assertNoAccessibilityViolations(page);

  const suffix = Date.now().toString(36);
  const groupName = `E2E Lifecycle Groep ${suffix}`;

  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupUrl = page.url();
  const groupId = groupUrl.match(/\/groups\/([^/?]+)/)![1]!;

  // --- place a pupil, through the live-search picker ---------------------------
  const studentFamilyName = `LifecycleLeerling${suffix}`;
  await createStudent(page, "Jorn", studentFamilyName);

  await page.goto(groupUrl);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page
    .locator("#placeReason")
    .fill("E2E: plaatsing voor de lifecycle-test");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  await expect(
    page.getByRole("row", { name: new RegExp(studentFamilyName) }),
  ).toBeVisible();

  // --- assign an instructor -----------------------------------------------------
  // No `/roles` or `/users` screen exists yet (`provision-persona.ts`'s own
  // header), and `assignInstructorAction` itself places no constraint on WHO a
  // `personId` may belong to — a plain `Person` id is exactly what the form's
  // free-text `#personId` field accepts. A second student-shaped person is
  // used here purely as "a `Person` with a name to look up", not to claim
  // they are a real member of staff.
  const instructorFamilyName = `LifecycleLesgever${suffix}`;
  const instructorPersonId = await createStudent(
    page,
    "Lena",
    instructorFamilyName,
  );

  await page.goto(groupUrl);
  await openDetails(page, "Lesgever toewijzen");
  await page.locator("#personId").fill(instructorPersonId);
  await page.locator("#role").fill("Hoofdinstructeur");
  await page.getByRole("button", { name: "Lesgever toewijzen" }).click();
  await expect(page).toHaveURL(/saved=instructor/);

  // --- both survive a real reload ------------------------------------------------
  await page.goto(groupUrl);
  await expect(
    page.getByRole("listitem").filter({ hasText: instructorFamilyName }),
  ).toContainText("Hoofdinstructeur");
  await expect(
    page.getByRole("row", { name: new RegExp(studentFamilyName) }),
  ).toBeVisible();

  void groupId;
});

test("D-108: een leerling verplaatsen van de ene groep naar de andere (moveStudentAction, alle richtingen zijn één actie)", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";
  const groupAName = `E2E Move Groep A ${suffix}`;
  const groupBName = `E2E Move Groep B ${suffix}`;

  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupAName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupAUrl = page.url();

  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupBName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupBUrl = page.url();

  const studentFamilyName = `Verplaatsleerling${suffix}`;
  await createStudent(page, "Milan", studentFamilyName);

  // YESTERDAY, not today (the field's own default): the move below closes
  // this placement at TODAY's date, and `IntervalError`'s
  // `endsBeforeItStarts` (`src/modules/groups/domain/interval.ts`,
  // `toDate > fromDate` STRICTLY) refuses closing an interval the same day
  // it opened. Opening it yesterday leaves today free to close it AND to
  // open the new membership on — the new one must land on today, not some
  // later date, or the group roster (which only lists CURRENT members,
  // `fromDate <= now`) would not show the pupil as placed yet.
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  await page.goto(groupAUrl);
  await openDetails(page, "Leerling plaatsen");
  await pickFromLiveSearch(
    page,
    "Zoek leerling op naam",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  await page
    .locator("#placeFromDate")
    .fill(yesterday.toISOString().slice(0, 10));
  await page
    .locator("#placeReason")
    .fill("E2E: plaatsing groep A, voor de verplaatsing");
  await page.getByRole("button", { name: "Plaatsen", exact: true }).click();
  await expect(page).toHaveURL(/saved=placed/);

  // --- move: A -> B, LATERAL ("zelfde niveau" — no promotion/demotion
  //     connotation either way, on the "one form, one button" reasoning
  //     `groups/[groupId]/page.tsx`'s own file comment gives for why the
  //     direction is an ordinary select rather than three separate buttons) --
  await page.goto(groupAUrl);
  await page
    .locator("#moveStudentProfileId")
    .selectOption({ label: `Milan ${studentFamilyName}` });
  await page.locator("#toGroupId").selectOption({ label: groupBName });
  await page.locator("#direction").selectOption({ label: "Zelfde niveau" });
  // `#occurredAt` keeps its own default (today) — see the comment above.
  const moveReason = `E2E: overgeplaatst naar groep B (${suffix})`;
  await page.locator("#moveReason").fill(moveReason);
  await page.getByRole("button", { name: "Verplaatsen" }).click();

  await expect(page).toHaveURL(/saved=moved/);

  // --- the pupil is now on B's roster, and gone from A's -----------------------
  await page.goto(groupBUrl);
  await expect(
    page.getByRole("row", { name: new RegExp(studentFamilyName) }),
  ).toBeVisible();

  await page.goto(groupAUrl);
  await expect(
    page.getByRole("row", { name: new RegExp(studentFamilyName) }),
  ).toHaveCount(0);
});
