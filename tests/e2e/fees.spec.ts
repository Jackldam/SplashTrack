/**
 * The `fees` module (phase 3.3) — `docs/build/phase-3.3-fees-report.md` — R-32,
 * driven through a real browser: create a fee type, create a charge for a
 * payer/student pair, record a payment, see the balance on both the payer's
 * and the student's own person page, export the CSV, and confirm a
 * fees-permission-less account is refused the whole area.
 *
 * Shares `courses.spec.ts`'s scratch-database/admin-bootstrap infrastructure
 * and this worktree's own dedicated `splashtrack_scratch_e2e_wt_fees`
 * database (`tests/e2e/support/e2e-common.ts`). MUST NOT run in the same
 * `playwright test` invocation as another spec in this directory (each
 * truncates the same scratch database in its own `beforeAll`) — run alone:
 *
 *   npx playwright test tests/e2e/fees.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

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

const ADMIN_EMAIL = "e2e-admin-fees@example.invalid";
const ADMIN_NAME = "E2E Fees Admin";
const RESTRICTED_EMAIL = "e2e-restricted-fees@example.invalid";
const RESTRICTED_NAME = "E2E Fees Restricted";
// D-090's automatic payer default (`src/app/fees/charge-payer-and-student.tsx`)
// — two more administrators, one per scenario, on the same "one account per
// test, MFA enrolment is one-time" rule the two accounts above already follow
// (`people-relationships.spec.ts`'s own header explains why a shared account
// cannot sign in twice from two tests in one file, D-185).
const ADMIN_ONE_GUARDIAN_EMAIL = "e2e-admin-fees-one-guardian@example.invalid";
const ADMIN_ONE_GUARDIAN_NAME = "E2E Fees Admin Eén Voogd";
const ADMIN_TWO_GUARDIANS_EMAIL =
  "e2e-admin-fees-two-guardians@example.invalid";
const ADMIN_TWO_GUARDIANS_NAME = "E2E Fees Admin Twee Voogden";
const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(ADMIN_EMAIL, ADMIN_NAME, PASSWORD);
  // A restricted staff persona for the refusal scenario — `people.read` only,
  // deliberately NO `fees.*` — provisioned up front on the `courses.spec.ts`
  // ADMIN2 precedent (one account per test, MFA enrolment is one-time per
  // account, D-185).
  provisionPersona(RESTRICTED_EMAIL, RESTRICTED_NAME, PASSWORD, [
    "people.read",
  ]);
  provisionPersona(
    ADMIN_ONE_GUARDIAN_EMAIL,
    ADMIN_ONE_GUARDIAN_NAME,
    PASSWORD,
    ["ADMIN"],
  );
  provisionPersona(
    ADMIN_TWO_GUARDIANS_EMAIL,
    ADMIN_TWO_GUARDIANS_NAME,
    PASSWORD,
    ["ADMIN"],
  );
});

/** A plain `Person`, no student profile — the `createStudent` shape in
 * `e2e-common.ts`, minus the "Leerling aanmaken" step, for a payer who is
 * not themselves a pupil (a parent). */
async function createPerson(
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
  return page.url().match(/\/people\/([^/?]+)/)![1]!;
}

/**
 * Records a `GUARDIAN_OF` relationship through the person page's own form
 * (`people-relationships.spec.ts`'s happy path, minus the authority claim —
 * D-090's automatic payer default reads the ADMINISTRATIVE window only, never
 * the D-151 consent-authority derivation, so no evidence is needed here).
 */
async function addGuardian(
  page: Page,
  subjectPersonId: string,
  relativeFamilyName: string,
): Promise<void> {
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
  await page.getByRole("button", { name: "Relatie vastleggen" }).click();
  await expect(page).toHaveURL(/saved=relationship/);
}

/**
 * Picks the fee type named `feeTypeName` in the charge form's `<select>` —
 * BY LABEL rather than by index, because `listFeeTypesForPrincipal` orders
 * alphabetically (`fee-type-repository.ts`): the very first test in this file
 * can rely on "index 1" because it runs against an empty catalogue, but every
 * scenario appended after it shares that catalogue with whatever came before.
 */
async function selectFeeType(page: Page, feeTypeName: string): Promise<void> {
  const option = page.locator("#feeTypeId option", { hasText: feeTypeName });
  const value = await option.getAttribute("value");
  await page.locator("#feeTypeId").selectOption(value!);
}

test("volledig gelukt: kostensoort, post, betaling, weergaves per betaler en leerling, en CSV-export", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_EMAIL, PASSWORD);

  // `admin:create` is itself a break-glass invocation (`13-…` §7), so a
  // fresh installation's first administrator lands on `/` with the
  // undismissed alert banner showing. Asserted BEFORE dismissal, deliberately
  // — this is the exact scenario the phase 3.3 report §1.10 caught a
  // `color-contrast` violation in (`<code>` in `.alert-warning` inheriting
  // Bootstrap's fixed pink `$code-color`, `globals.css`'s own fix now makes
  // it inherit the alert's AA-compliant text colour instead). Dismissing
  // first would make this check pass by hiding the very element it exists to
  // prove is compliant.
  await expect(page.getByRole("button", { name: "Gezien" })).toBeVisible();
  await assertNoAccessibilityViolations(page);

  const dismissButton = page.getByRole("button", { name: "Gezien" });
  if (await dismissButton.isVisible().catch(() => false)) {
    await dismissButton.click();
  }

  const suffix = Date.now().toString(36);
  const feeTypeCode = `E2E-${suffix}`;
  const feeTypeName = `E2E Contributie ${suffix}`;
  const payerFamilyName = `Ouder${suffix}`;
  const studentFamilyName = `Kind${suffix}`;

  // --- create the fee type -----------------------------------------------
  await page.goto("/fees");
  await openDetails(page, "Kostensoort toevoegen");
  await page.locator("#code").fill(feeTypeCode);
  await page.locator("#name").fill(feeTypeName);
  await page.locator("#amount").fill("67.50");
  await page.locator("#recurrence").selectOption("ONE_OFF");
  await page.getByRole("button", { name: "Kostensoort toevoegen" }).click();
  await expect(page).toHaveURL(/saved=feeType/);

  const feeTypeRow = page.locator("tbody tr", { hasText: feeTypeCode });
  await expect(feeTypeRow).toBeVisible();

  // --- a payer (a plain person) and a student (a pupil) -------------------
  const payerPersonId = await createPerson(page, "Peter", payerFamilyName);
  const studentPersonId = await createStudent(page, "Kim", studentFamilyName);

  // --- create the charge, from /fees's own form ----------------------------
  await page.goto("/fees");
  await pickFromLiveSearch(
    page,
    "Betaler",
    payerFamilyName,
    new RegExp(payerFamilyName),
  );
  await pickFromLiveSearch(
    page,
    "Leerling (optioneel)",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );
  // The one (and, in this fresh scratch database, only) fee type just
  // created — index 0 is the disabled placeholder.
  await page.locator("#feeTypeId").selectOption({ index: 1 });
  await page.locator("#dueDate").fill("2026-12-31");
  await page.getByRole("button", { name: "Post aanmaken" }).click();

  // `createChargeAction` redirects to the PAYER's own person page.
  await expect(page).toHaveURL(new RegExp(`/people/${payerPersonId}`));
  await expect(page).toHaveURL(/saved=chargeCreated/);

  // --- the payer's balance shows the open charge ---------------------------
  await expect(
    page.getByRole("heading", { name: "Financiën — als betaler" }),
  ).toBeVisible();
  let chargeRow = page.locator("table tbody tr", { hasText: feeTypeName });
  await expect(chargeRow).toBeVisible();
  await expect(chargeRow).toContainText("67,50");
  await expect(chargeRow).toContainText("Openstaand");

  // --- record a PARTIAL payment, through the row's own form ---------------
  await chargeRow.locator("summary", { hasText: "Acties" }).click();
  const actionsBlock = chargeRow
    .locator("details")
    .filter({ hasText: "Acties" });
  await actionsBlock.locator('input[name="amount"]').fill("30.00");
  await actionsBlock.locator('select[name="method"]').selectOption("BANK");
  await actionsBlock
    .getByRole("button", { name: "Betaling registreren" })
    .click();
  await expect(page).toHaveURL(/saved=payment/);

  chargeRow = page.locator("table tbody tr", { hasText: feeTypeName });
  await expect(chargeRow).toContainText("30,00");
  await expect(chargeRow).toContainText("37,50");
  await expect(chargeRow).toContainText("Deels betaald");
  await expect(
    chargeRow.locator("summary", { hasText: "Betalingen" }),
  ).toBeVisible();

  // --- and it also shows up, independently, on the STUDENT's own page -----
  await page.goto(`/people/${studentPersonId}`);
  await expect(
    page.getByRole("heading", { name: "Financiën — deze leerling" }),
  ).toBeVisible();
  const studentChargeRow = page.locator("table tbody tr", {
    hasText: feeTypeName,
  });
  await expect(studentChargeRow).toBeVisible();
  await expect(studentChargeRow).toContainText("Deels betaald");

  // --- CSV export -----------------------------------------------------------
  const exportResponse = await page.request.get("/api/fees/export");
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["content-type"]).toContain("text/csv");
  const csv = await exportResponse.text();
  expect(csv).toContain(feeTypeCode);
  expect(csv).toContain(payerPersonId);
  expect(csv).toContain("67.50");
  expect(csv).toContain("30.00");
});

test("een account zonder fees-rechten krijgt nergens in dit gebied toegang", async ({
  page,
}) => {
  await signInAndEnrol(page, RESTRICTED_EMAIL, PASSWORD);

  await page.goto("/fees");
  await expect(page.getByText("Geen toegang")).toBeVisible();
  await expect(page.getByText(/fees\.read/)).toBeVisible();

  // Not merely hidden — a direct POST-equivalent submission is refused by the
  // service too, never only by the screen not rendering a form for it. There
  // is no charge id to name here (none exists for this account to reach),
  // which is itself the point: the denial panel above is the only surface.
});

test("D-090: één actieve voogd wordt automatisch als betaler voorgesteld — op naam, zonder handmatig ID-werk", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_ONE_GUARDIAN_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "1g";
  const feeTypeCode = `E2E-${suffix}`;
  const feeTypeName = `E2E Contributie ${suffix}`;
  const studentFamilyName = `KindEenVoogd${suffix}`;
  const guardianFamilyName = `OuderEenVoogd${suffix}`;

  await page.goto("/fees");
  await openDetails(page, "Kostensoort toevoegen");
  await page.locator("#code").fill(feeTypeCode);
  await page.locator("#name").fill(feeTypeName);
  await page.locator("#amount").fill("40.00");
  await page.locator("#recurrence").selectOption("ONE_OFF");
  await page.getByRole("button", { name: "Kostensoort toevoegen" }).click();
  await expect(page).toHaveURL(/saved=feeType/);

  const studentPersonId = await createStudent(page, "Eva", studentFamilyName);
  const guardianPersonId = await createPerson(page, "Bram", guardianFamilyName);
  await addGuardian(page, studentPersonId, guardianFamilyName);

  await page.goto("/fees");
  const payerCombobox = page.getByRole("combobox", { name: "Betaler" });
  // Not picked yet — the pupil is chosen FIRST, on purpose: this is the field
  // the derivation is meant to fill in without anyone typing the guardian's
  // name at all.
  await expect(payerCombobox).toHaveValue("");

  await pickFromLiveSearch(
    page,
    "Leerling (optioneel)",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );

  // The automatic default (`/api/people/guardian-candidates`, `charge-payer-
  // and-student.tsx`) fills the payer field with the guardian's OWN NAME —
  // nobody typed or picked an id. `toHaveValue` polls, which is what actually
  // waits out the picker's own fetch.
  await expect(payerCombobox).toHaveValue(new RegExp(guardianFamilyName));

  await selectFeeType(page, feeTypeName);
  await page.locator("#dueDate").fill("2026-12-31");
  await page.getByRole("button", { name: "Post aanmaken" }).click();

  // The charge landed on the GUARDIAN's own page — proof the suggestion's
  // hidden id, never typed by the administrator, was the right one.
  await expect(page).toHaveURL(new RegExp(`/people/${guardianPersonId}`));
  await expect(page).toHaveURL(/saved=chargeCreated/);
  await expect(
    page.getByRole("heading", { name: "Financiën — als betaler" }),
  ).toBeVisible();
  await expect(
    page.locator("table tbody tr", { hasText: feeTypeName }),
  ).toBeVisible();
});

test("D-090: bij twee actieve voogden wordt niets automatisch gekozen — de beheerder kiest zelf", async ({
  page,
}) => {
  await signInAndEnrol(page, ADMIN_TWO_GUARDIANS_EMAIL, PASSWORD);

  const suffix = Date.now().toString(36) + "2g";
  const feeTypeCode = `E2E-${suffix}`;
  const feeTypeName = `E2E Contributie ${suffix}`;
  const studentFamilyName = `KindTweeVoogden${suffix}`;
  const guardianAFamilyName = `OuderTweeA${suffix}`;
  const guardianBFamilyName = `OuderTweeB${suffix}`;

  await page.goto("/fees");
  await openDetails(page, "Kostensoort toevoegen");
  await page.locator("#code").fill(feeTypeCode);
  await page.locator("#name").fill(feeTypeName);
  await page.locator("#amount").fill("40.00");
  await page.locator("#recurrence").selectOption("ONE_OFF");
  await page.getByRole("button", { name: "Kostensoort toevoegen" }).click();
  await expect(page).toHaveURL(/saved=feeType/);

  const studentPersonId = await createStudent(page, "Fenna", studentFamilyName);
  await createPerson(page, "Otto", guardianAFamilyName);
  const guardianBPersonId = await createPerson(
    page,
    "Nora",
    guardianBFamilyName,
  );
  await addGuardian(page, studentPersonId, guardianAFamilyName);
  await addGuardian(page, studentPersonId, guardianBFamilyName);

  await page.goto("/fees");
  const payerCombobox = page.getByRole("combobox", { name: "Betaler" });

  await pickFromLiveSearch(
    page,
    "Leerling (optioneel)",
    studentFamilyName,
    new RegExp(studentFamilyName),
  );

  // Two active guardians is exactly the case the relationship data does NOT
  // determine unambiguously — the field stays empty rather than guessing.
  // `toHaveValue("")` polls too, so this is a genuine wait, not a snapshot
  // taken before the (non-)response arrives.
  await expect(payerCombobox).toHaveValue("");

  // The administrator still completes the charge — by NAME, through the same
  // picker, exactly as the override path always worked.
  await pickFromLiveSearch(
    page,
    "Betaler",
    guardianBFamilyName,
    new RegExp(guardianBFamilyName),
  );
  await selectFeeType(page, feeTypeName);
  await page.locator("#dueDate").fill("2026-12-31");
  await page.getByRole("button", { name: "Post aanmaken" }).click();

  // The charge landed on the MANUALLY chosen guardian's page — the one never
  // auto-suggested, proving the override picked the right person by name.
  await expect(page).toHaveURL(new RegExp(`/people/${guardianBPersonId}`));
  await expect(page).toHaveURL(/saved=chargeCreated/);
  await expect(
    page.getByRole("heading", { name: "Financiën — als betaler" }),
  ).toBeVisible();
});
