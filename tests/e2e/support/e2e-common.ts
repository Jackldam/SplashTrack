/**
 * Small helpers shared by the assessment/exams e2e specs — the same
 * MFA-enrolment and `<details>` helpers `group-course-level.spec.ts` and
 * `catalogue-json-import.spec.ts` each define locally, lifted out because a
 * THIRD and FOURTH spec need the identical thing rather than a third/fourth
 * copy. Nothing here changes the pattern those two files established; see
 * `group-course-level.spec.ts`'s own header for why a dedicated scratch
 * database and a fresh admin per run.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, type Page } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
export const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** This worktree's own dedicated e2e scratch database — see `.env.e2e`. */
export const SCRATCH_DB_NAME = "splashtrack_scratch_e2e_wt_attendance";

export function resetScratchDatabase(): void {
  execFileSync(
    TSX_BIN,
    ["scripts/reset-scratch-database.ts", SCRATCH_DB_NAME],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
    },
  );
}

export function createAdmin(
  email: string,
  name: string,
  password: string,
): void {
  execFileSync(
    "npm",
    ["run", "cli", "--", "admin:create", "--email", email, "--name", name],
    {
      cwd: REPO_ROOT,
      input: `${password}\n${password}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}

/**
 * A restricted, non-administrator account, plus a role carrying EXACTLY the
 * permissions named — see `provision-persona.ts`'s own header for why this
 * exists as a script rather than a UI flow (there is none).
 */
export function provisionPersona(
  email: string,
  name: string,
  password: string,
  permissions: readonly string[],
): { personId: string; email: string; roleId: string } {
  const output = execFileSync(
    TSX_BIN,
    [
      "tests/e2e/support/provision-persona.ts",
      "create-account",
      "--email",
      email,
      "--name",
      name,
      "--password",
      password,
      "--permissions",
      permissions.join(","),
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return JSON.parse(output.trim().split("\n").pop()!) as {
    personId: string;
    email: string;
    roleId: string;
  };
}

/** `PersonQualification` has no UI anywhere in this build — see the same file. */
export function grantQualification(personId: string, type: string): void {
  execFileSync(
    TSX_BIN,
    [
      "tests/e2e/support/provision-persona.ts",
      "grant-qualification",
      "--personId",
      personId,
      "--type",
      type,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
}

/** Base32 manual-key -> current TOTP code — `group-course-level.spec.ts`'s helper. */
export async function totpCodeFromManualKey(
  manualKey: string,
): Promise<string> {
  const secret = manualKey.replace(/ /g, "");
  const key = new TextDecoder().decode(base32.decode(secret));
  return createOTP(key).totp();
}

/** Opens a collapsed `<details><summary>` section. */
export async function openDetails(page: Page, summaryText: string) {
  const summary = page.locator("summary", { hasText: summaryText });
  const details = summary.locator("xpath=..");
  if (!(await details.getAttribute("open"))) {
    await summary.click();
  }
}

/**
 * Signs a (possibly brand-new, unenrolled) account in and takes it through
 * MFA enrolment — the D-185 browser flow, identical for the CLI-created
 * administrator and a script-provisioned restricted account: enrolment is
 * per-account state, not an admin-only screen (`src/lib/auth/session.ts`'s
 * `mfaPending`).
 */
export async function signInAndEnrol(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Verder" }).click();

  await expect(page).toHaveURL(/\/mfa-enrolment$/);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Toon de QR-code" }).click();

  const manualKey = await page
    .locator("code.user-select-all")
    .first()
    .innerText();
  const code = await totpCodeFromManualKey(manualKey);

  await page.locator("#code").fill(code);
  await page.getByRole("button", { name: "Instellen afronden" }).click();
  await expect(page).toHaveURL(/\/$/);
}

/**
 * Fills a `LiveSearchPicker` (`src/components/live-search-picker`) by typing
 * a query into its `combobox` and clicking the matching `option` — the one
 * client-side interactive control these specs need to drive, used by the
 * guest picker, the "place student" picker and the relative picker alike.
 */
export async function pickFromLiveSearch(
  page: Page,
  comboboxLabel: string,
  query: string,
  optionText: string | RegExp,
): Promise<void> {
  const combobox = page.getByRole("combobox", { name: comboboxLabel });
  await combobox.fill(query);
  const option = page.getByRole("option", { name: optionText });
  await expect(option).toBeVisible();
  await option.click();
}

/**
 * Everything an aftest — or, for `exams-candidate-confirm.spec.ts`, an exam
 * candidacy built on top of one — needs to exist first: a published,
 * one-criterion criterion set (pass floor "Voldoende"), a course level bound
 * to its award type, a group bound to that level, and one `ScheduledSession`
 * TODAY (so an exam candidacy's "currently active group member" check and an
 * aftest's own roster both hold without a second day's wait). Shared by both
 * specs — see `assessment-aftest.spec.ts`'s own scenarios for the aftest
 * half of what this sets up.
 */
export async function setUpCourseGroupAndSession(
  page: Page,
  suffix: string,
  labelPrefix: string,
): Promise<{
  awardTypeId: string;
  awardName: string;
  groupId: string;
  groupUrl: string;
  sessionUrl: string;
}> {
  const awardCode = `E2E-${labelPrefix}-${suffix}`;
  const awardName = `E2E ${labelPrefix} Diploma ${suffix}`;
  const courseName = `E2E ${labelPrefix} Cursus ${suffix}`;
  const levelName = `E2E ${labelPrefix} Niveau ${suffix}`;
  const groupName = `E2E ${labelPrefix} Groep ${suffix}`;

  // --- the award type and its ACTIVE criterion set -------------------------
  await page.goto("/skills");
  await openDetails(page, "Diploma of certificaat toevoegen");
  await page.locator("#code").fill(awardCode);
  await page.locator("#name").fill(awardName);
  await page.locator("#kind").selectOption("DIPLOMA");
  await page.locator("#issuingBody").selectOption("ORG");
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page).toHaveURL(/\/skills\/[^/?]+$/);
  const awardTypeId = page.url().match(/\/skills\/([^/?]+)/)![1]!;

  await openDetails(page, "Nieuwe eisenset beginnen");
  await page.locator("#newSetSource").selectOption("ORG");
  await page.getByRole("button", { name: "Concept beginnen" }).click();
  await expect(page).toHaveURL(/\/skills\/[^/?]+\/sets\/[^/?]+$/);

  await openDetails(page, "Eis toevoegen");
  await page.locator("#newCriterionCode").fill("E1");
  await page.locator("#newCriterionName").fill("Kopspringen");
  await page.getByRole("button", { name: "Eis toevoegen" }).click();
  await expect(page).toHaveURL(/saved=criterion/);

  await openDetails(page, "Eisenset aanpassen");
  await page.locator("#editPassFloor").selectOption({ label: "Voldoende" });
  await page
    .locator("form", { has: page.locator("#editPassFloor") })
    .getByRole("button", { name: "Opslaan" })
    .click();
  await expect(page).toHaveURL(/saved=criterionSet/);

  await page.getByRole("button", { name: "Publiceren" }).click();
  await expect(page).toHaveURL(/saved=published/);
  await expect(page.getByText(/^Actief/)).toBeVisible();

  // --- the course, its level, and the award type it points to --------------
  await page.goto("/courses");
  await openDetails(page, "Cursus toevoegen");
  await page.locator("#name").fill(courseName);
  await page.getByRole("button", { name: "Cursus toevoegen" }).click();
  await expect(page).toHaveURL(/\/courses\/[^/?]+$/);

  await openDetails(page, "Niveau toevoegen");
  await page.locator("#newLevelName").fill(levelName);
  await page.getByRole("button", { name: "Niveau toevoegen" }).click();
  await expect(page).toHaveURL(/saved=level/);

  const levelAwardSelect = page.locator('select[name="awardTypeId"]').first();
  await levelAwardSelect.selectOption({ label: awardName });
  await page
    .locator("form", { has: levelAwardSelect })
    .getByRole("button", { name: "Opslaan" })
    .click();
  await expect(page).toHaveURL(/saved=level/);

  // --- the group, bound to that level ---------------------------------------
  await page.goto("/groups");
  await openDetails(page, "Nieuwe groep");
  await page.locator("#name").fill(groupName);
  await page.getByRole("button", { name: "Groep aanmaken" }).click();
  await expect(page).toHaveURL(/\/groups\/[^/?]+$/);
  const groupUrl = page.url();
  const groupId = groupUrl.match(/\/groups\/([^/?]+)/)![1]!;

  await openDetails(page, "Groep bewerken");
  await page
    .locator("#editCourseLevel")
    .selectOption({ label: `${courseName} — ${levelName}` });
  await page
    .locator("form", { has: page.locator("#editCourseLevel") })
    .getByRole("button", { name: "Opslaan" })
    .click();
  await expect(page).toHaveURL(/saved=group/);

  // --- one lesson, today -----------------------------------------------------
  await page.goto(`/groups/${groupId}/schedule`);
  const startsOnValue = await page.locator("#startsOn").inputValue();
  // ISO weekday (1 = Monday .. 7 = Sunday), computed from the SAME date the
  // form itself defaults to — never from `new Date()` in the test process,
  // which could disagree with the server's own timezone by a day at the
  // boundary (`resolveTimeZone`, `formatSessionMoment`).
  const [y, m, d] = startsOnValue.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  const isoWeekday = jsDay === 0 ? 7 : jsDay;

  await openDetails(page, "Lesreeks toevoegen");
  await page.locator("#weekday").selectOption(String(isoWeekday));
  await page.locator("#startTime").fill("18:00");
  await page.locator("#durationMinutes").fill("45");
  await page.locator("#startsOn").fill(startsOnValue);
  await page.locator("#endsOn").fill(startsOnValue);
  await page.getByRole("button", { name: "Lesreeks toevoegen" }).click();
  // The redirect is a real navigation (a Server Action `redirect()`, not a
  // client-side transition) — wait for it before touching the "generate"
  // form below, or the fill can land on the pre-navigation DOM and be lost.
  await expect(page).toHaveURL(/saved=recurrence/);

  await page.locator("#generateFrom").fill(startsOnValue);
  await page.locator("#generateTo").fill(startsOnValue);
  await page.getByRole("button", { name: "Lessen aanmaken" }).click();

  const sessionLink = page.locator('a[href*="/sessions/"]').first();
  await expect(sessionLink).toBeVisible();
  const href = await sessionLink.getAttribute("href");
  const sessionUrl = new URL(href!, page.url()).toString();

  return { awardTypeId, awardName, groupId, groupUrl, sessionUrl };
}

/** Creates a pupil (a `Person` + `StudentProfile`) and returns their person id. */
export async function createStudent(
  page: Page,
  givenName: string,
  familyName: string,
): Promise<string> {
  await page.goto("/people");
  await openDetails(page, "Nieuwe persoon");
  await page.locator("#givenName").fill(givenName);
  await page.locator("#familyName").fill(familyName);
  await page.getByRole("button", { name: "Persoon aanmaken" }).click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);
  const personId = page.url().match(/\/people\/([^/?]+)/)![1]!;

  await page.getByRole("button", { name: "Leerling aanmaken" }).click();
  await expect(page).toHaveURL(/saved=/);

  return personId;
}
