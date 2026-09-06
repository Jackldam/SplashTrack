/**
 * The phase 1.7 walkthrough, driven through a real browser over HTTPS: rename a
 * pool, add lanes, and get home from three different depths.
 *
 * NOT part of the test suite and not shipped, exactly like
 * `uat-walkthrough.mjs` — it exists so the walkthrough in
 * `docs/build/phase-1.7-correctability-and-navigation-report.md` is a
 * transcript rather than a description, and so the next person to touch these
 * screens can re-run it in one command.
 *
 *     node scripts/phase-1.7-walkthrough.mjs <base-url> [--insecure]
 *
 * IT WORKS AGAINST BOTH KINDS OF INSTANCE, because the two it has to run on are
 * different:
 *
 *   • An instance that is NOT set up yet runs the wizard first, with a password
 *     this script generates and never prints. That is the only way an agent can
 *     hold an account at all — `admin:create` refuses a second administrator on
 *     a set-up instance (D-141), which is correct and is why the phase 1.7
 *     report walks a throwaway stack rather than the owner's UAT database.
 *   • An instance that IS set up signs in with `UAT_ADMIN_PASSWORD` from the
 *     environment. That is the path the OWNER runs, on his own instance, with
 *     his own password — which never reaches this file, a command line, or a
 *     transcript.
 *
 * It creates a pool with a deliberate typo and corrects it, which is the defect
 * this phase was opened for.
 */

import { chromium } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const baseUrl = args.find((a) => !a.startsWith("--"));
const insecure = args.includes("--insecure");
if (!baseUrl) {
  console.error(
    "usage: node scripts/phase-1.7-walkthrough.mjs <base-url> [--insecure]",
  );
  process.exit(2);
}

/** Read from a file, never a flag: a token in `argv` is in every process list. */
const tokenFile = process.env.SETUP_TOKEN_FILE;
const EMAIL = process.env.WALKTHROUGH_EMAIL ?? "walkthrough@example.invalid";
const ORGANISATION = "Zwemschool Walkthrough";
/** Generated here and never printed. Only ever typed into a form. */
const PASSWORD =
  process.env.UAT_ADMIN_PASSWORD ??
  `${randomBytes(24).toString("base64url")}Aa1!`;

const step = (n, what) => console.log(`\n─── ${n}. ${what}\n`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ ignoreHTTPSErrors: insecure });
const page = await context.newPage();
page.setDefaultTimeout(120_000);
page.setDefaultNavigationTimeout(120_000);

async function alertText(selector) {
  await page.waitForFunction(
    (css) => (document.querySelector(css)?.textContent ?? "").trim().length > 0,
    selector,
  );
  return (await page.locator(selector).innerText()).trim();
}

/** Taps the header's home link and reports where it landed. */
async function goHomeFrom(label) {
  const from = page.url();
  await page.click("header .st-home-link");
  await page.waitForURL((url) => new URL(url).pathname === "/");
  console.log(`from ${label}`);
  console.log(`  was:  ${from}`);
  console.log(`  now:  ${page.url()}`);
  console.log(`  h1:   ${await page.locator("main h1").first().innerText()}`);
}

try {
  step(0, `GET ${baseUrl}/`);
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  console.log(`landed on: ${page.url()}`);

  if (page.url().endsWith("/setup")) {
    step(1, "not set up: running the wizard to get an account");
    const token = readFileSync(tokenFile, "utf8").trim();
    await page.fill("#token", token);
    await page.click('button[type="submit"]');
    await page.waitForSelector("#organizationName");

    await page.fill("#organizationName", ORGANISATION);
    await page.fill("#name", "Walkthrough");
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.fill("#passwordConfirmation", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() =>
      document.body.innerText.includes("Stap 3"),
    );

    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector("svg[role='img']");
    const manualKey = (
      await page.locator("code.user-select-all").first().innerText()
    ).trim();
    const secret = new TextDecoder().decode(
      base32.decode(manualKey.replace(/\s+/g, "")),
    );
    await page.fill("#code", await createOTP(secret).totp());
    await page.click('form:has(#code) button[type="submit"]');
    await page.waitForURL((url) => new URL(url).pathname === "/");
    console.log("enrolled; signed in");
  } else if (page.url().endsWith("/sign-in")) {
    step(1, "already set up: signing in");
    if (!process.env.UAT_ADMIN_PASSWORD) {
      throw new Error(
        "This instance is set up. Set UAT_ADMIN_PASSWORD and WALKTHROUGH_EMAIL.",
      );
    }
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForSelector("#code");
    throw new Error(
      "Signed in as far as the second factor. Finish this step by hand, or " +
        "extend the script with the owner's TOTP source.",
    );
  }

  step(2, "the landing page, and the header that is now on every page");
  console.log(
    `h1:        ${await page.locator("main h1").first().innerText()}`,
  );
  console.log(
    `header:    "${(await page.locator("header").innerText()).trim()}" -> ` +
      `${await page.locator("header a").first().getAttribute("href")}`,
  );
  console.log(
    `modules:   ${(await page.locator("main a").allInnerTexts()).join(", ")}`,
  );

  step(3, "a pool, created with the typo this phase exists for");
  await page.click('main a:has-text("groepen")');
  await page.waitForURL(/\/groups$/);
  await page.click('a:has-text("Baden en banen")');
  await page.waitForURL(/\/groups\/pools$/);
  console.log(`now at:    ${page.url()}`);
  console.log(
    `crumb:     ${(await page.locator('nav[aria-label="kruimelpad"] a').allInnerTexts()).join(" / ")}`,
  );

  await page.click('summary:has-text("Bad toevoegen")');
  await page.fill("#poolName", "Instructiebda");
  await page.fill("#lengthMetres", "20");
  await page.click('form:has(#poolName) button[type="submit"]');
  await page.waitForURL(/saved=pool/);
  console.log(
    `saved:     ${await alertText('div[role="status"].alert-success')}`,
  );
  console.log(
    `list:      ${(await page.locator("ul.list-group > li summary strong").allInnerTexts()).join(", ")}`,
  );

  step(4, "correcting it — the thing that was impossible");
  await page.click('summary:has-text("Instructiebda")');
  const poolBlock = page.locator('li:has(summary:has-text("Instructiebda"))');
  await poolBlock.locator('input[name="name"]').first().fill("Instructiebad");
  await poolBlock.locator('input[name="lengthMetres"]').first().fill("25");
  await poolBlock.locator('button:has-text("Bad opslaan")').click();
  await page.waitForURL(/saved=poolUpdated/);
  console.log(
    `saved:     ${await alertText('div[role="status"].alert-success')}`,
  );
  console.log(
    `list:      ${(await page.locator("ul.list-group > li summary").allInnerTexts()).join(" | ").replace(/\s+/g, " ")}`,
  );

  step(5, "adding lanes — the capability no screen ever called");
  for (const [index, lane] of ["baan 1", "baan 2"].entries()) {
    await page.click('summary:has-text("Instructiebad")');
    const block = page.locator('li:has(summary:has-text("Instructiebad"))');
    await block.locator('input[name="name"]').last().fill(lane);
    await block.locator('button:has-text("Baan toevoegen")').click();
    // Waiting for the URL is not enough on the second pass: it already carries
    // `saved=lane` from the first, so the match returns before the new document
    // is the one being read. Wait for the lane the save produced.
    await page.waitForFunction(
      (n) => document.querySelectorAll('input[name="laneId"]').length === n,
      index + 1,
    );
    console.log(
      `added ${lane}: ${await alertText('div[role="status"].alert-success')}`,
    );
  }
  console.log(
    `list:      ${(await page.locator("ul.list-group > li summary").allInnerTexts()).join(" | ").replace(/\s+/g, " ")}`,
  );

  step(6, "a group, so the lane has a schedule to appear in");
  await page.goto(`${baseUrl}/groups`, { waitUntil: "networkidle" });
  await page.click('summary:has-text("Nieuwe groep")');
  await page.fill("#name", "Groep 21");
  await page.click('form:has(#name) button[type="submit"]');
  await page.waitForURL(/\/groups\/[^/]+$/);
  const groupUrl = page.url();
  console.log(`group at:  ${groupUrl}`);

  await page.click('a:has-text("Rooster")');
  await page.waitForURL(/\/schedule$/);
  await page.click('summary:has-text("Lesreeks toevoegen")');
  console.log(
    `pool opts: ${(await page.locator("#poolId option").allInnerTexts()).join(" | ")}`,
  );

  step(7, "home, from three different depths");
  await goHomeFrom("/groups/<id>/schedule  (three segments deep)");
  await page.goto(`${baseUrl}/groups/pools`, { waitUntil: "networkidle" });
  await goHomeFrom("/groups/pools          (two segments deep)");
  await page.goto(`${baseUrl}/people`, { waitUntil: "networkidle" });
  await goHomeFrom("/people                (one segment deep)");
} finally {
  await browser.close();
}
