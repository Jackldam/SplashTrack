/**
 * The person page's relationship form (`recordRelationshipAction`,
 * `src/app/people/actions.ts` — `src/modules/people/application/
 * relationship-service.ts`), driven through a real browser: the "PR #19"
 * fix that replaced the old two-step "search, then choose from a `<select>`"
 * flow with the `LiveSearchPicker` (`git show 60529c6`, `git show e30775c`,
 * per that component's own file comment), and D-063's own gate — an
 * authority (custody/parental-responsibility) claim MUST carry a typed basis,
 * or it is refused, visibly, before anything is written.
 *
 * Three scenarios:
 *
 *  1. A COMPLETE happy path: add a relationship between two people through
 *     the live-search picker, claim authority ("mag toestemming geven"), and
 *     — since a claim needs a basis (D-063) — supply the required evidence
 *     text. The relationship shows up on BOTH sides: the subject's own
 *     "Wie is verantwoordelijk voor deze persoon" table, and the relative's
 *     own "Voor wie is deze persoon verantwoordelijk" table.
 *
 *  2. The rejected scenario the fix's own gate exists for: claim authority
 *     WITHOUT typing the evidence. Refused with `AUTHORITY_REQUIRES_EVIDENCE`,
 *     shown as a real `alert-danger`, and nothing is written — the subject's
 *     guardians table stays empty.
 *
 *  3. The `LiveSearchPicker` itself (`src/components/live-search-picker/
 *     live-search-picker.tsx`), on the two paths no existing spec drives:
 *     every other spec that uses `pickFromLiveSearch`
 *     (`tests/e2e/support/e2e-common.ts`) only ever clicks a matching
 *     option — never a query with NO match, and never a KEYBOARD selection
 *     (arrow keys + Enter, or Escape to back out without picking). Folded in
 *     here, on this file's own picker, rather than given a separate spec
 *     file: this relationship form is already the one screen in this
 *     directory whose whole point is the picker, and neither path needs a
 *     scratch database of its own to prove.
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. MUST NOT run in the same `playwright
 * test` invocation as another spec in this directory (each truncates the
 * same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/people-relationships.spec.ts
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

// THREE administrator accounts, one per test — see `assessment-aftest.spec.ts`'s
// own comment on `beforeAll` for why a SHARED admin account cannot sign in
// twice from two tests in one file (MFA enrolment is one-time per account,
// D-185). Only the FIRST goes through `admin:create` — the CLI refuses the
// moment a first account exists at all, enrolled or not — so the second and
// third are provisioned via `provision-persona.ts`'s `ADMIN` sentinel.
const ADMIN_EMAIL = "e2e-admin-relationships@example.invalid";
const ADMIN_NAME = "E2E Relationships Admin";
const ADMIN2_EMAIL = "e2e-admin-relationships-2@example.invalid";
const ADMIN2_NAME = "E2E Relationships Admin Twee";
const ADMIN3_EMAIL = "e2e-admin-relationships-3@example.invalid";
const ADMIN3_NAME = "E2E Relationships Admin Drie";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  provisionPersona(ADMIN2_EMAIL, ADMIN2_NAME, PASSWORD, ["ADMIN"]);
  provisionPersona(ADMIN3_EMAIL, ADMIN3_NAME, PASSWORD, ["ADMIN"]);
});

test("compleet gelukt: een relatie toevoegen via de live-search picker, met een onderbouwde gezagsclaim", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  await assertNoAccessibilityViolations(page);

  const suffix = Date.now().toString(36);
  const subjectFamilyName = `RelatieKind${suffix}`;
  const relativeFamilyName = `RelatieOuder${suffix}`;

  // The subject needs a `dateOfBirth` for authority to resolve `ACTIVE`
  // rather than `LAPSED_UNKNOWN_BIRTHDATE` (D-172, `guardian-authority.ts`:
  // "the subject has no `dateOfBirth`" is a real, expected outcome, not a
  // bug — but it is not the one this happy path is meant to show). Inlined
  // rather than added to `createStudent` (`e2e-common.ts`): every OTHER
  // caller of that helper is indifferent to the date of birth, and giving it
  // one by default would be a fact those specs never asked for.
  const eightYearsAgo = new Date();
  eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);
  await page.goto("/people");
  await openDetails(page, "Nieuwe persoon");
  await page.locator("#givenName").fill("Fenna");
  await page.locator("#familyName").fill(subjectFamilyName);
  await page
    .locator("#dateOfBirth")
    .fill(eightYearsAgo.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Persoon aanmaken" }).click();
  await expect(page).toHaveURL(/\/people\/[^/?]+$/);
  const subjectPersonId = page.url().match(/\/people\/([^/?]+)/)![1]!;
  await page.getByRole("button", { name: "Leerling aanmaken" }).click();
  await expect(page).toHaveURL(/saved=/);

  const relativePersonId = await createStudent(page, "Sem", relativeFamilyName);

  await page.goto(`/people/${subjectPersonId}`);
  await expect(
    page.getByText(
      "Niemand is vastgelegd als verantwoordelijke voor deze persoon.",
    ),
  ).toBeVisible();

  await openDetails(page, "Relatie toevoegen");
  await pickFromLiveSearch(
    page,
    "Zoek de andere persoon op naam",
    relativeFamilyName,
    new RegExp(relativeFamilyName),
  );
  await page
    .locator("#relationshipType")
    .selectOption({ label: "Ouder of voogd" });
  await page.locator("#authority").check();
  const evidence = `E2E: moeder, opgegeven bij inschrijving (${suffix})`;
  await page.locator("#evidence").fill(evidence);
  await page.getByRole("button", { name: "Relatie vastleggen" }).click();

  await expect(page).toHaveURL(/saved=relationship/);

  // --- on the SUBJECT's own page: the guardians table ---------------------------
  const guardianRow = page
    .getByRole("heading", { name: "Wie is verantwoordelijk voor deze persoon" })
    .locator("xpath=following::table[1]")
    .locator("tbody tr", { hasText: relativeFamilyName });
  await expect(guardianRow).toBeVisible();
  await expect(guardianRow).toContainText("Ouder of voogd");
  await expect(guardianRow).toContainText("Geldig");

  // --- and on the RELATIVE's own page: the dependants table ----------------------
  await page.goto(`/people/${relativePersonId}`);
  const dependantRow = page
    .getByRole("heading", { name: "Voor wie is deze persoon verantwoordelijk" })
    .locator("xpath=following::table[1]")
    .locator("tbody tr", { hasText: subjectFamilyName });
  await expect(dependantRow).toBeVisible();
  await expect(dependantRow).toContainText("Ouder of voogd");
});

test("D-063: een gezagsclaim zonder onderbouwing wordt geweigerd, en er wordt niets vastgelegd", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN2_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "b";
  const subjectFamilyName = `GeenOnderbouwingKind${suffix}`;
  const relativeFamilyName = `GeenOnderbouwingOuder${suffix}`;
  const subjectPersonId = await createStudent(page, "Nova", subjectFamilyName);
  await createStudent(page, "Ties", relativeFamilyName);

  await page.goto(`/people/${subjectPersonId}`);
  await openDetails(page, "Relatie toevoegen");
  await pickFromLiveSearch(
    page,
    "Zoek de andere persoon op naam",
    relativeFamilyName,
    new RegExp(relativeFamilyName),
  );
  await page
    .locator("#relationshipType")
    .selectOption({ label: "Ouder of voogd" });
  await page.locator("#authority").check();
  // Deliberately no `#evidence` — the exact refusal D-063's gate exists for.
  await page.getByRole("button", { name: "Relatie vastleggen" }).click();

  await expect(page).toHaveURL(/error=AUTHORITY_REQUIRES_EVIDENCE/);
  await expect(page.locator(".alert-danger")).toContainText(
    "Vul de onderbouwing in wanneer je aanvinkt dat deze persoon toestemming mag geven",
  );

  // Nothing was written — the guardians table is still genuinely empty, not
  // merely missing the authority claim.
  await expect(
    page.getByText(
      "Niemand is vastgelegd als verantwoordelijke voor deze persoon.",
    ),
  ).toBeVisible();
  await expect(page.getByText(relativeFamilyName)).toHaveCount(0);
});

test("de live-search picker: geen resultaten, Escape zonder keuze, en een keuze met het toetsenbord", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN3_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "c";
  const subjectFamilyName = `PickerKind${suffix}`;
  const relativeFamilyName = `PickerOuder${suffix}`;
  const subjectPersonId = await createStudent(page, "Vince", subjectFamilyName);
  await createStudent(page, "Roos", relativeFamilyName);

  await page.goto(`/people/${subjectPersonId}`);
  await openDetails(page, "Relatie toevoegen");

  const combobox = page.getByRole("combobox", {
    name: "Zoek de andere persoon op naam",
  });

  // --- no results: a query that matches nobody -----------------------------------
  const nonsenseQuery = `Zzznietbestaand${suffix}`;
  await combobox.fill(nonsenseQuery);
  const listbox = page.getByRole("listbox");
  await expect(listbox.getByText(new RegExp(`Geen resultaten`))).toBeVisible();
  // Scoped to THIS listbox, not a bare `page.getByRole("option")`: the person
  // page carries several native `<select>`s of its own (relationship type,
  // enrolment status, lifecycle event), and every `<option>` on the page has
  // the SAME implicit ARIA role — an unscoped query would count those too.
  await expect(listbox.getByRole("option")).toHaveCount(0);

  // --- Escape closes the dropdown without picking anything -----------------------
  await combobox.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(combobox).toHaveValue(nonsenseQuery);

  // --- a real match, chosen with the KEYBOARD, not a click ------------------------
  await combobox.fill(relativeFamilyName);
  const option = page.getByRole("option", {
    name: new RegExp(relativeFamilyName),
  });
  await expect(option).toBeVisible();
  await combobox.press("ArrowDown");
  await combobox.press("Enter");

  // The visible field now shows the picked option's own label, and the
  // dropdown is gone — the same post-pick state a mouse click leaves
  // (`select()`, `live-search-picker.tsx`), reached here via the keyboard
  // path instead.
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(combobox).toHaveValue(new RegExp(relativeFamilyName));

  // And the pick is real: the hidden field it fills is what the form submits,
  // so finishing the form records a relationship with the RIGHT person.
  await page
    .locator("#relationshipType")
    .selectOption({ label: "Noodcontact" });
  await page.getByRole("button", { name: "Relatie vastleggen" }).click();
  await expect(page).toHaveURL(/saved=relationship/);

  const guardianRow = page
    .getByRole("heading", { name: "Wie is verantwoordelijk voor deze persoon" })
    .locator("xpath=following::table[1]")
    .locator("tbody tr", { hasText: relativeFamilyName });
  await expect(guardianRow).toBeVisible();
  await expect(guardianRow).toContainText("Noodcontact");
});
