/**
 * First Playwright spec in the repository (`tests/e2e/` did not exist before
 * this file). It exists to catch the regression `src/app/groups/actions.ts`
 * just had: `updateGroupAction` read every field off the group-edit form
 * EXCEPT `courseLevelId`, so the level `<select>` on
 * `src/app/groups/[groupId]/page.tsx` silently did nothing on save. Only a
 * real browser, submitting the real form, against the real update action,
 * would have caught that — a unit test on the service layer calls it with the
 * field already present and never notices the screen never sent it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS AGAINST ITS OWN, DEDICATED, DISPOSABLE DATABASE
 *
 * `playwright.config.ts`'s `webServer` runs `next build && next start` against
 * whatever `DATABASE_URL`/`DATABASE_MAINTENANCE_URL` are in the process
 * environment when `playwright test` is invoked — the same env this spec file
 * runs in. Pointing that at the DEV database would mean an e2e run creates a
 * real administrator account and real course/group rows in the database a
 * human developer is looking at; pointing it at vitest's `_test` database risks
 * two suites racing each other on the same rows (`setup-test-db.ts`'s audit
 * truncate, `boot-state-matrix.test.ts`'s throwaway databases).
 *
 * So this spec owns a THIRD database, `splashtrack_scratch_e2e_test`, and
 * `test.beforeAll` below empties it with `scripts/reset-scratch-database.ts`
 * before every run (see that script's own comment for why TRUNCATE-in-place
 * rather than `scripts/recreate-database.ts`'s drop-and-recreate). That is
 * also what makes the MFA enrolment below repeatable: `enableTwoFactor`'s
 * QR/secret is shown to the browser exactly once per account (D-185), so a
 * run that reused a once-enrolled account would only ever pass the first
 * time. Starting from a migrated-but-empty database and creating a fresh
 * admin every run sidesteps that entirely — no secret to persist across runs,
 * nothing to clean up after.
 *
 * ONE-TIME SETUP, before the very first run only (the database itself has to
 * exist and be migrated before `reset-scratch-database.ts` can truncate
 * anything in it):
 *
 *   set -a; source .env.e2e; set +a
 *   npx tsx scripts/recreate-database.ts splashtrack_scratch_e2e_test
 *
 * REQUIRED ENVIRONMENT — this spec does not set it itself (Playwright's
 * `webServer` must see the same variables the test does, and it starts before
 * any spec file runs), so it must already be exported in the shell that
 * invokes `playwright test`. See `.env.e2e` in the repo root:
 *
 *   set -a; source .env.e2e; set +a
 *   npx playwright test tests/e2e/group-course-level.spec.ts
 *
 * `.env.e2e` is gitignored (matched by the existing `.env.*` pattern) and
 * documents the database name, the role reuse and the port choice (3001 —
 * 3000 is already in use on this host) in full.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

// Matches `scripts/recreate-database.ts`'s `ALLOWED_NAME` guard — it refuses
// any name that does not announce itself as a scratch database, precisely so
// this spec cannot be pointed at dev/prod by a copy-paste mistake.
const SCRATCH_DB_NAME = "splashtrack_scratch_e2e_test";

const ADMIN_EMAIL = "e2e-admin@example.invalid";
const ADMIN_NAME = "E2E Admin";
const ADMIN_PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  // 1. An empty, already-migrated database — TRUNCATE every table in place
  //    (`scripts/reset-scratch-database.ts`), not drop-and-recreate: by the
  //    time this runs, Playwright's own `webServer` (`next build && next
  //    start`, started before any spec body) already holds an open connection
  //    to this database as the RUNTIME role, and `DROP DATABASE ... WITH
  //    (FORCE)` needs a privilege over THAT session the retention role does
  //    not have (see the reset script's own comment for why granting it would
  //    be the wrong fix). An admin account and its verified MFA factor from a
  //    PRIOR run must not still be here, or `admin:create` below refuses
  //    (setup already complete) and the enrolment screen below would never
  //    appear — TRUNCATE achieves the same "genuinely empty" starting point
  //    without touching the database's own existence.
  execFileSync(
    TSX_BIN,
    ["scripts/reset-scratch-database.ts", SCRATCH_DB_NAME],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

  // 2. One administrator account, `mfa_pending` — the CLI's own documented
  //    non-interactive shape: the password is piped in twice (it prompts for
  //    confirmation) and MFA is deliberately left for the browser (D-185).
  execFileSync(
    "npm",
    [
      "run",
      "cli",
      "--",
      "admin:create",
      "--email",
      ADMIN_EMAIL,
      "--name",
      ADMIN_NAME,
    ],
    {
      cwd: REPO_ROOT,
      input: `${ADMIN_PASSWORD}\n${ADMIN_PASSWORD}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
});

/**
 * Computes the current TOTP code from the manual-key text the enrolment
 * screen renders (`src/app/mfa-enrolment/enrolment-flow.tsx`'s
 * `<code class="user-select-all">{start.manualKey}</code>`), the same way
 * `tests/integration/mfa-enrolment.test.ts` derives a valid code from a
 * `totpURI`'s `secret` param: base32-decode the key, hand it to
 * `createOTP().totp()`. The manual key is grouped in 4-character chunks for
 * transcription (`^(\w{4} )*\w{1,4}$`), so the spaces come out first.
 */
async function totpCodeFromManualKey(manualKey: string): Promise<string> {
  const secret = manualKey.replace(/ /g, "");
  const key = new TextDecoder().decode(base32.decode(secret));
  return createOTP(key).totp();
}

/** Opens a collapsed `<details><summary>{title}</summary>...</details>`
 *  section — every create/edit form on `groups`/`courses` screens is one, and
 *  Playwright cannot fill a field a closed `<details>` is hiding. */
async function openDetails(
  page: import("@playwright/test").Page,
  summaryText: string,
) {
  const summary = page.locator("summary", { hasText: summaryText });
  const details = summary.locator("xpath=..");
  if (!(await details.getAttribute("open"))) {
    await summary.click();
  }
}

test("a group's course level survives a save and a reload, and can be cleared again", async ({
  page,
}) => {
  // --- Sign in (password step) --------------------------------------------
  await page.goto("/sign-in");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Verder" }).click();

  // A brand-new admin has no verified factor yet, so sign-in lands on the
  // enrolment screen (D-185), not on a two-factor code prompt.
  await expect(page).toHaveURL(/\/mfa-enrolment$/);

  // --- MFA enrolment (D-185) ----------------------------------------------
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Toon de QR-code" }).click();

  const manualKey = await page
    .locator("code.user-select-all")
    .first()
    .innerText();
  const code = await totpCodeFromManualKey(manualKey);

  await page.locator("#code").fill(code);
  await page.getByRole("button", { name: "Instellen afronden" }).click();

  // Enrolment verified: back on the home page with a full, non-pending
  // session.
  await expect(page).toHaveURL(/\/$/);

  // --- Seed a course, a level, and a group, all through the real UI --------
  const uniqueSuffix = Date.now().toString(36);
  const courseName = `E2E Cursus ${uniqueSuffix}`;
  const levelName = `E2E Niveau ${uniqueSuffix}`;
  const groupName = `E2E Groep ${uniqueSuffix}`;

  await page.goto("/courses");
  await openDetails(page, "Cursus toevoegen");
  await page.locator("#name").fill(courseName);
  await page.getByRole("button", { name: "Cursus toevoegen" }).click();

  // `createCourseAction` redirects to `/courses/[courseId]` on success.
  await expect(page).toHaveURL(/\/courses\/[^/?]+$/);

  await openDetails(page, "Niveau toevoegen");
  await page.locator("#newLevelName").fill(levelName);
  await page.getByRole("button", { name: "Niveau toevoegen" }).click();
  await expect(page).toHaveURL(/saved=level/);
  // The level's name sits inside an editable `<input>` on this table row (the
  // level list doubles as an inline rename form), so its VALUE is what to
  // check — `getByText` only ever matches rendered text nodes, never an
  // input's value.
  await expect(
    page.getByRole("row", { name: new RegExp(levelName) }),
  ).toBeVisible();

  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();

  // `createGroupAction` redirects straight to the new group's own page.
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupUrl = page.url();

  // --- The actual regression: set a level, save, reload, and it must stick -
  await openDetails(page, "Groep bewerken");
  const levelSelect = page.locator("#editCourseLevel");
  const editForm = page.locator("form", {
    has: page.locator("#editCourseLevel"),
  });

  // The option label is `"{courseName} — {levelName}"`
  // (`courseLevelOptionLabel` in `src/app/courses/format.ts`), not the level
  // name alone.
  await levelSelect.selectOption({ label: `${courseName} — ${levelName}` });
  // The id backing the label just chosen — captured BEFORE submitting, so the
  // post-reload assertion checks the actual foreign key, not just the label
  // text (two levels could share a name across courses).
  const levelId = await levelSelect.evaluate(
    (el) => (el as HTMLSelectElement).value,
  );
  expect(levelId).not.toBe("");

  await editForm.getByRole("button", { name: "Opslaan" }).click();
  await expect(page).toHaveURL(/saved=group/);

  // Reload from scratch — a real navigation, not a client-side re-render, so
  // this proves the value came back from the database rather than surviving
  // only in React state.
  await page.goto(groupUrl);
  await openDetails(page, "Groep bewerken");
  await expect(page.locator("#editCourseLevel")).toHaveValue(levelId);
  await expect(page.locator("#editCourseLevel option:checked")).toHaveText(
    new RegExp(levelName),
  );

  // --- Clear it again: back to "no level", save, reload, and it must be
  //     genuinely empty (not the old value lingering) -----------------------
  await page.locator("#editCourseLevel").selectOption({ value: "" });
  await editForm.getByRole("button", { name: "Opslaan" }).click();
  await expect(page).toHaveURL(/saved=group/);

  await page.goto(groupUrl);
  await openDetails(page, "Groep bewerken");
  await expect(page.locator("#editCourseLevel")).toHaveValue("");
});
