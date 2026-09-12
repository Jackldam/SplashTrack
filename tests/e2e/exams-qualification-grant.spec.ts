/**
 * The `PersonQualification` grant screen (the person page's "Bevoegdheden"
 * section, `grantQualificationAction` — `src/app/exams/actions.ts`), driven
 * through a real browser. Until this screen existed, `grantQualificationAction`
 * had no form anywhere in `src/app`: no browser-reachable way existed to
 * grant a qualification, so D-085's four-eyes gate (an `ExamCandidate` may
 * only reach `CONFIRMED` when graded by a `PersonQualification` holder) could
 * never be satisfied through the product itself. This spec proves the gap is
 * closed: grant a qualification through the screen and see it listed.
 *
 * `exams-candidate-confirm.spec.ts` also drives this same screen now
 * (`grantQualificationViaUI`, `e2e-common.ts`), as part of its own two full
 * candidacy scenarios — this spec is the narrower, standalone proof that the
 * screen itself works: the empty state, the grant, and the resulting row.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`'s own header for why. MUST NOT run in the
 * same `playwright test` invocation as another spec in this directory (each
 * truncates the same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/exams-qualification-grant.spec.ts
 */
import { expect, test } from "@playwright/test";

import {
  createAdmin,
  createStudent,
  grantQualificationViaUI,
  resetScratchDatabase,
  signInAndEnrol,
} from "./support/e2e-common";

const ADMIN_EMAIL = "e2e-admin-qualification@example.invalid";
const ADMIN_NAME = "E2E Bevoegdheden Admin";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
});

test("kent een bevoegdheid toe via het scherm, en die verschijnt in de lijst", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36);
  const familyName = `Beoordelaar${suffix}`;
  const personId = await createStudent(page, "Kwalificatie", familyName);

  await page.goto(`/people/${personId}`);
  await expect(
    page.getByText("Deze persoon heeft nog geen bevoegdheid."),
  ).toBeVisible();

  // `type` is a closed vocabulary (`PersonQualificationType`,
  // `prisma/schema.prisma`) — a `<select>`, not a free-text field. The
  // person page has several unrelated `name="type"` selects (lifecycle
  // event, relationship type), so `grantQualificationViaUI` scopes to the
  // "Bevoegdheden" form specifically.
  await grantQualificationViaUI(page, personId, "EXTERNAL_EXAMINER");
  await expect(
    page.getByText("Deze persoon heeft nog geen bevoegdheid."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Externe examinator" }),
  ).toBeVisible();
  await expect(page.getByText("Nog geldig")).toBeVisible();
});
