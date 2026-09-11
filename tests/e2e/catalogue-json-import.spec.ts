/**
 * D-188's JSON surface, driven through a real browser — export, edit, and
 * re-upload a catalogue, and the deliberate-refusal path: an upload with one
 * broken criterion leaves the catalogue exactly as it was.
 *
 * Shares `tests/e2e/group-course-level.spec.ts`'s infrastructure (scratch
 * database, admin bootstrap, MFA enrolment) — see that file's own comment for
 * why a dedicated, disposable `splashtrack_scratch_e2e_test` database and a
 * fresh admin per run. This spec truncates that same database again in its
 * own `beforeAll`, so it is safe to run alone (`npx playwright test
 * tests/e2e/catalogue-json-import.spec.ts`) but MUST NOT be run in the same
 * `playwright test` invocation as another spec unless Playwright serialises
 * spec FILES too — two files truncating the same database from independent
 * workers would race.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

const SCRATCH_DB_NAME = "splashtrack_scratch_e2e_test";

const ADMIN_EMAIL = "e2e-admin-catalogue@example.invalid";
const ADMIN_NAME = "E2E Catalogue Admin";
const ADMIN_PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  execFileSync(
    TSX_BIN,
    ["scripts/reset-scratch-database.ts", SCRATCH_DB_NAME],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

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

/** Base32 manual-key -> current TOTP code — `group-course-level.spec.ts`'s helper. */
async function totpCodeFromManualKey(manualKey: string): Promise<string> {
  const secret = manualKey.replace(/ /g, "");
  const key = new TextDecoder().decode(base32.decode(secret));
  return createOTP(key).totp();
}

/** Opens a collapsed `<details><summary>` section. */
async function openDetails(page: Page, summaryText: string) {
  const summary = page.locator("summary", { hasText: summaryText });
  const details = summary.locator("xpath=..");
  if (!(await details.getAttribute("open"))) {
    await summary.click();
  }
}

async function signInAndEnrol(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Verder" }).click();

  await expect(page).toHaveURL(/\/mfa-enrolment$/);
  await page.locator("#password").fill(ADMIN_PASSWORD);
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

interface CatalogueGradeRef {
  gradeScale: string;
  grade: string;
}
interface CatalogueCriterionDocument {
  code: string;
  name: string;
  standard: string | null;
  sequence: number;
  minimumGrade: CatalogueGradeRef | null;
}
interface CatalogueCriterionSetDocument {
  version: number;
  source: string;
  status: string;
  passFloor: CatalogueGradeRef | null;
  criteria: CatalogueCriterionDocument[];
}
interface CatalogueAwardTypeDocument {
  code: string;
  name: string;
  kind: string;
  issuingBody: string;
  criterionSets: CatalogueCriterionSetDocument[];
}
interface CatalogueDocument {
  catalogueVersion: number;
  awardTypes: CatalogueAwardTypeDocument[];
}

test("exports the catalogue, edits it, re-imports it, and rejects a broken upload without changing anything", async ({
  page,
}) => {
  await signInAndEnrol(page);

  const uniqueSuffix = Date.now().toString(36);
  const awardCode = `E2E-${uniqueSuffix}`;
  const awardName = `E2E Diploma ${uniqueSuffix}`;

  // --- Seed one award type with a DRAFT criterion set and one criterion,
  //     through the ordinary form — this is the catalogue the export/import
  //     round trip below is verified against. -----------------------------
  await page.goto("/skills");
  await openDetails(page, "Diploma of certificaat toevoegen");
  await page.locator("#code").fill(awardCode);
  await page.locator("#name").fill(awardName);
  await page.locator("#kind").selectOption("DIPLOMA");
  await page.locator("#issuingBody").selectOption("ORG");
  await page.getByRole("button", { name: "Toevoegen" }).click();

  await expect(page).toHaveURL(/\/skills\/[^/?]+$/);
  const awardTypeUrl = page.url();

  await openDetails(page, "Nieuwe eisenset beginnen");
  await page.locator("#newSetSource").selectOption("ORG");
  await page.getByRole("button", { name: "Concept beginnen" }).click();
  await expect(page).toHaveURL(/\/skills\/[^/?]+\/sets\/[^/?]+$/);
  const setUrl = page.url();

  await openDetails(page, "Eis toevoegen");
  await page.locator("#newCriterionCode").fill("E1");
  await page.locator("#newCriterionName").fill("Eerste eis");
  await page.getByRole("button", { name: "Eis toevoegen" }).click();
  await expect(page).toHaveURL(/saved=criterion/);

  // --- Export the full catalogue via the download link --------------------
  await page.goto("/skills");
  await openDetails(page, "Catalogus als JSON");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Volledige catalogus exporteren" }).click(),
  ]);
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();
  const fs = await import("node:fs/promises");
  const exportedText = await fs.readFile(exportPath!, "utf8");
  const exported = JSON.parse(exportedText) as CatalogueDocument;

  const exportedAwardType = exported.awardTypes.find(
    (a) => a.code === awardCode,
  );
  expect(exportedAwardType).toBeDefined();
  expect(exportedAwardType!.criterionSets[0]?.criteria[0]?.name).toBe(
    "Eerste eis",
  );

  // --- Edit the export in memory: correct the criterion's name, add a
  //     second one — the "meerdere diploma's in bulk" case D-188 exists for,
  //     scaled down to one changed field and one addition. ------------------
  const modified: CatalogueDocument = structuredClone(exported);
  const modifiedAwardType = modified.awardTypes.find(
    (a) => a.code === awardCode,
  )!;
  modifiedAwardType.criterionSets[0]!.criteria[0]!.name =
    "Eerste eis (aangepast via JSON)";
  modifiedAwardType.criterionSets[0]!.criteria.push({
    code: "E2",
    name: "Tweede eis, via JSON toegevoegd",
    standard: null,
    sequence: 2,
    minimumGrade: null,
  });

  // --- Re-upload the edited document — happy path --------------------------
  await page.goto("/skills");
  await openDetails(page, "Catalogus als JSON");
  await page.locator("#catalogueJsonFile").setInputFiles({
    name: "catalogus-bewerkt.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(modified, null, 2), "utf8"),
  });
  await page.getByRole("button", { name: "Importeren" }).click();

  await expect(page.getByRole("status")).toContainText("Geïmporteerd");

  // Confirm on the actual criterion-set screen: the corrected name and the
  // new criterion are both there, from the database, after a real navigation.
  // A still-DRAFT set renders each criterion as an editable row (an
  // `<input name="name" defaultValue={criterion.name}>`, not plain text —
  // `group-course-level.spec.ts`'s own comment on why a value belongs in
  // `toHaveValue`, never `getByText`, applies here too), in sequence order.
  await page.goto(setUrl);
  const nameInputs = page.locator("table").locator('input[name="name"]');
  await expect(nameInputs).toHaveCount(2);
  await expect(nameInputs.nth(0)).toHaveValue(
    "Eerste eis (aangepast via JSON)",
  );
  await expect(nameInputs.nth(1)).toHaveValue(
    "Tweede eis, via JSON toegevoegd",
  );

  // --- Deliberate refusal: a document with a blank criterion name ----------
  const broken: CatalogueDocument = structuredClone(modified);
  const brokenAwardType = broken.awardTypes.find((a) => a.code === awardCode)!;
  // A THIRD criterion, invalid: requiredText refuses a blank name deep inside
  // the document — exactly the "error in the middle" scenario.
  brokenAwardType.criterionSets[0]!.criteria.push({
    code: "E3",
    name: "   ",
    standard: null,
    sequence: 3,
    minimumGrade: null,
  });
  // Also rename the award type itself, so a wrongly-partial import would be
  // visible immediately on the list.
  brokenAwardType.name = "DIT MAG NOOIT OPGESLAGEN WORDEN";

  await page.goto("/skills");
  await openDetails(page, "Catalogus als JSON");
  await page.locator("#catalogueJsonFile").setInputFiles({
    name: "catalogus-kapot.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(broken, null, 2), "utf8"),
  });
  await page.getByRole("button", { name: "Importeren" }).click();

  await expect(page.getByText(/Import geweigerd/)).toBeVisible();
  // The award type's name on the LIST is unaffected by the refused upload —
  // the all-or-nothing guarantee, checked from the browser's own next render
  // of the real data.
  await expect(page.getByText("DIT MAG NOOIT OPGESLAGEN WORDEN")).toHaveCount(
    0,
  );
  await expect(page.getByText(awardName, { exact: true })).toBeVisible();

  // And from the award type's own detail screen: the name is still the
  // original one (the h1 renders `{name} ({code})`, so a substring match),
  // and its criterion set still holds exactly the two accepted criteria —
  // no third, no name change.
  await page.goto(awardTypeUrl);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    awardName,
  );
  await page.goto(setUrl);
  await expect(nameInputs).toHaveCount(2);
  await expect(nameInputs.nth(0)).toHaveValue(
    "Eerste eis (aangepast via JSON)",
  );
  await expect(nameInputs.nth(1)).toHaveValue(
    "Tweede eis, via JSON toegevoegd",
  );
  await expect(
    page.locator("table").locator('input[name="code"]').nth(2),
  ).toHaveCount(0);
});
