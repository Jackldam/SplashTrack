/**
 * Phase 3.2 — the settings registry (R-17) and the diagnostics page (R-21),
 * driven through a real browser.
 *
 * Four scenarios:
 *
 *  1. A setting changed on `/admin/settings` takes effect immediately — no
 *     redeploy, no restart (`13-…` §4) — verified by reloading the running
 *     server (never restarted between the write and the re-read) and seeing
 *     the new value, on the settings page AND the diagnostics page.
 *  2. An `invariant` setting renders as a stated fact, never an editable
 *     control (§3.2).
 *  3. `/admin/diagnostics` renders no secret values (only `secretSet`).
 *  4. D-141's lockout invariant, verified two ways — see
 *     `support/lockout-invariant-check.ts`'s header for why the settings-
 *     write REFUSAL cannot be observed as a rendered banner in ANY browser
 *     session (reaching the settings screen already proves the acting admin
 *     is themselves a qualifying account): the ALLOWED case is shown live in
 *     the browser (two admins, one stripped of MFA, the remaining one still
 *     succeeds), and the REFUSED case is exercised against the same real
 *     database with the service called directly, once zero qualifying
 *     accounts genuinely remain.
 *
 * EACH TEST USES ITS OWN, FRESH ADMINISTRATOR ACCOUNT, on
 * `exams-candidate-confirm.spec.ts`'s precedent: `signInAndEnrol` drives the
 * ONE-TIME (D-185) MFA enrolment flow, so an account already enrolled by an
 * earlier test cannot go through it a second time. `admin:create` (via
 * `createAdmin`) provisions the very first one — boot state requires it —
 * every subsequent admin is provisioned through `provisionPersona`'s `ADMIN`
 * sentinel (the seeded `instance_administrator` role, `provision-persona.ts`'s
 * own comment on why the CLI cannot make a second one).
 *
 * Shares `group-course-level.spec.ts`'s scratch-database/admin-bootstrap
 * infrastructure and this worktree's own dedicated
 * `splashtrack_scratch_e2e_wt_attendance` database — see
 * `tests/e2e/support/e2e-common.ts`. Run alone:
 *
 *   npx playwright test tests/e2e/settings-diagnostics.spec.ts
 */
import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  assertNoAccessibilityViolations,
  createAdmin,
  provisionPersona,
  REPO_ROOT,
  resetScratchDatabase,
  signInAndEnrol,
  TSX_BIN,
} from "./support/e2e-common";

const PASSWORD = "E2eTestPassw0rd!2026";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  resetScratchDatabase();
  createAdmin(
    "e2e-admin-settings-live@example.invalid",
    "E2E Settings Admin (live-apply)",
    PASSWORD,
  );
});

function stripMfa(email: string): void {
  execFileSync(TSX_BIN, ["tests/e2e/support/strip-mfa.ts", email], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

function checkLockoutInvariant(email: string): "REFUSED" | "ALLOWED" {
  const output = execFileSync(
    TSX_BIN,
    ["tests/e2e/support/lockout-invariant-check.ts", email],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  // Match by CONTAINS rather than "the last line": the audit logger's own
  // debug line for the refusal event is sometimes flushed to the same stdout
  // stream after the script's own `console.log`, which would otherwise beat
  // an exact last-line match.
  const refused = /(?:^|\n)REFUSED(?:\n|$)/.test(output);
  const allowed = /(?:^|\n)ALLOWED(?:\n|$)/.test(output);
  if (refused === allowed) {
    throw new Error(`Unexpected output: ${output}`);
  }
  return refused ? "REFUSED" : "ALLOWED";
}

test("a changed setting applies live — no restart, no redeploy (13-… §4)", async ({
  page,
}) => {
  await signInAndEnrol(
    page,
    "e2e-admin-settings-live@example.invalid",
    PASSWORD,
  );
  await page.goto("/admin/settings");
  await assertNoAccessibilityViolations(page);

  const supportEmailKey = "organization.supportEmail";
  const newValue = `support-${Date.now().toString(36)}@example.invalid`;

  const row = page.locator(".list-group-item", { hasText: supportEmailKey });
  await row.getByRole("textbox", { name: supportEmailKey }).fill(newValue);
  await row.getByRole("button", { name: "Opslaan" }).click();

  await expect(page).toHaveURL(/updated=organization\.supportEmail/);
  await expect(
    page.getByText(`Instelling "${supportEmailKey}" is opgeslagen.`),
  ).toBeVisible();

  // Reload the SAME running server (never restarted) and confirm the new
  // value is what is now rendered — the live-apply property itself.
  await page.goto("/admin/settings");
  await expect(
    page
      .locator(".list-group-item", { hasText: supportEmailKey })
      .getByRole("textbox", { name: supportEmailKey }),
  ).toHaveValue(newValue);

  // The diagnostics page's effective-configuration table reads the SAME
  // registry and must show the identical live value with source "database".
  await page.goto("/admin/diagnostics");
  const diagCell = page.getByTestId(`diag-value-${supportEmailKey}`);
  await expect(diagCell).toHaveText(newValue);
});

test("an invariant setting renders as a stated fact, not an editable control (§3.2)", async ({
  page,
}) => {
  const admin = provisionPersona(
    "e2e-admin-settings-invariant@example.invalid",
    "E2E Settings Admin (invariant)",
    PASSWORD,
    ["ADMIN"],
  );
  await signInAndEnrol(page, admin.email, PASSWORD);
  await page.goto("/admin/settings");

  const invariantRow = page.locator(".list-group-item", {
    hasText: "authentication.mfaRequiredForHighRisk",
  });
  await expect(invariantRow.getByTestId("invariant-badge")).toBeVisible();
  await expect(invariantRow.locator("form")).toHaveCount(0);
});

test("diagnostics renders no secrets, only whether one is set, and reports D-141 status", async ({
  page,
}) => {
  const admin = provisionPersona(
    "e2e-admin-settings-diag@example.invalid",
    "E2E Settings Admin (diagnostics)",
    PASSWORD,
    ["ADMIN"],
  );
  await signInAndEnrol(page, admin.email, PASSWORD);

  // Set the SMTP password secret first, through the settings page.
  await page.goto("/admin/settings");
  const secretRow = page.locator(".list-group-item", {
    hasText: "email.smtpPassword",
  });
  const secretValue = "sup3r-s3cr3t-smtp-password";
  await secretRow.getByLabel("email.smtpPassword").fill(secretValue);
  await secretRow.getByRole("button", { name: "Opslaan" }).click();
  await expect(page).toHaveURL(/updated=email\.smtpPassword/);

  await page.goto("/admin/diagnostics");
  await assertNoAccessibilityViolations(page);

  // The secret's plaintext must never appear anywhere on the page.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain(secretValue);

  const secretCell = page.getByTestId("diag-value-email.smtpPassword");
  await expect(secretCell).toHaveText("ingesteld");

  await expect(page.getByTestId("diag-db-status")).toHaveText("Verbonden");
  await expect(page.getByTestId("diag-migration-state")).toHaveText("CURRENT");
  await expect(page.getByTestId("diag-lockout-invariant")).toContainText(
    "In orde",
  );
});

test("D-141: allowed while a qualifying account remains, refused once none does", async ({
  page,
}) => {
  const first = provisionPersona(
    "e2e-admin-settings-d141-a@example.invalid",
    "E2E Settings Admin (D-141, A)",
    PASSWORD,
    ["ADMIN"],
  );
  const second = provisionPersona(
    "e2e-admin-settings-d141-b@example.invalid",
    "E2E Settings Admin (D-141, B)",
    PASSWORD,
    ["ADMIN"],
  );
  await signInAndEnrol(page, first.email, PASSWORD);

  // A SECOND real browser MFA enrolment (D-185), in its own context so it
  // does not disturb the first admin's session.
  const secondContext = await page.context().browser()!.newContext();
  const secondPage = await secondContext.newPage();
  await signInAndEnrol(secondPage, second.email, PASSWORD);
  await secondContext.close();

  // Two qualifying accounts now exist. Strip the SECOND admin's factor —
  // simulating a reset TOTP, an operational event no UI performs (see
  // `strip-mfa.ts`) — leaving exactly one: the first admin.
  stripMfa(second.email);

  // ALLOWED, live in the browser: the first admin, still the sole
  // qualifying account, can still change an Authentication-category setting.
  await page.goto("/admin/settings");
  const pwRow = page.locator(".list-group-item", {
    hasText: "authentication.passwordMinLength",
  });
  await pwRow
    .getByRole("spinbutton", { name: "authentication.passwordMinLength" })
    .fill("13");
  await pwRow.getByRole("button", { name: "Opslaan" }).click();
  await expect(page).toHaveURL(/updated=authentication\.passwordMinLength/);

  // REFUSED: strip EVERY account's factor — the first admin's own, and every
  // earlier test's admin in this same scratch database (each enrolled for
  // real, D-185, and never un-enrolled) — so the database-wide qualifying-
  // account count is genuinely zero. No browser session can observe this AS
  // a rendered refusal (see this file's header), so it is exercised directly
  // against the same database, from the same scratch-database state the
  // browser scenario above just left behind.
  execFileSync(TSX_BIN, ["tests/e2e/support/strip-all-mfa.ts"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  expect(checkLockoutInvariant(first.email)).toBe("REFUSED");
});
