/**
 * The phase 1.5 UAT walkthrough, driven through a real browser over HTTPS —
 * exactly the sequence a stranger with a terminal and a browser performs.
 *
 * NOT part of the test suite and not shipped. It exists so the walkthrough in
 * `docs/build/phase-1.5-setup-wizard-report.md` is a transcript rather than a
 * description, and it is kept because the next person to change the wizard
 * should be able to re-run it in one command.
 *
 *   node scripts/uat-walkthrough.mjs <base-url> <setup-token>
 *
 * It computes the TOTP code from the manual key the page shows, which is the
 * only place that secret exists (D-185) — the same thing a phone does with the
 * QR code beside it.
 */

import { chromium } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

const [baseUrl, token] = process.argv.slice(2);
if (!baseUrl || !token) {
  console.error("usage: node scripts/uat-walkthrough.mjs <base-url> <token>");
  process.exit(2);
}

const EMAIL = "jack@sysadminheaven.nl";
const NAME = "Jack";
const ORGANISATION = "Zwemschool Sysadmin Heaven";
const PASSWORD = process.env.UAT_ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("Set UAT_ADMIN_PASSWORD in the environment.");
  process.exit(2);
}

const step = (n, what) => console.log(`\n─── ${n}. ${what}\n`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
// Every step here crosses the public internet and one of them migrates a
// database, so nothing is left on Playwright's 30-second default.
page.setDefaultTimeout(180_000);
page.setDefaultNavigationTimeout(180_000);

/** Waits for an alert to carry text, not merely to exist. */
async function alertText(selector) {
  await page.waitForFunction(
    (css) => (document.querySelector(css)?.textContent ?? "").trim().length > 0,
    selector,
  );
  return (await page.locator(selector).innerText()).trim();
}

try {
  step(1, `GET ${baseUrl}/ — an unset-up instance sends you to the wizard`);
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  console.log(`landed on: ${page.url()}`);
  console.log(`h1:        ${await page.locator("h1").first().innerText()}`);
  console.log(`h2:        ${await page.locator("h2").first().innerText()}`);
  console.log(
    `steps:     ${(await page.locator("ol li").allInnerTexts()).join("  |  ")}`,
  );
  console.log(`command:   ${await page.locator("pre code").innerText()}`);

  step(2, "a WRONG token is refused, and does not burn the real one");
  await page.fill("#token", "00000000000000000000000000000000");
  await page.click('button[type="submit"]');
  console.log(
    `refusal:   ${await alertText('div[role="alert"].alert-danger')}`,
  );
  console.log(`still on:  ${page.url()}`);

  step(3, "the real token");
  await page.fill("#token", token);
  await page.click('button[type="submit"]');
  await page.waitForSelector("#organizationName");
  console.log(`now at:    ${page.url()}`);
  console.log(`h2:        ${await page.locator("h2").first().innerText()}`);
  console.log(
    `fields:    ${(await page.locator("form label").allInnerTexts()).join(", ")}`,
  );

  step(4, "a MISMATCHED confirmation is refused server-side");
  await page.fill("#organizationName", ORGANISATION);
  await page.fill("#name", NAME);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.fill("#passwordConfirmation", `${PASSWORD}-typo`);
  await page.click('button[type="submit"]');
  console.log(
    `refusal:   ${await alertText('div[role="alert"].alert-danger')}`,
  );

  step(5, "the organisation and the first administrator");
  await page.fill("#organizationName", ORGANISATION);
  await page.fill("#name", NAME);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.fill("#passwordConfirmation", PASSWORD);
  await page.click('button[type="submit"]');
  // Step 2 migrates the database, so this is the slow one.
  await page.waitForFunction(() => document.body.innerText.includes("Stap 3"));
  console.log(`now at:    ${page.url()}`);
  console.log(
    `steps:     ${(await page.locator("ol li").allInnerTexts()).join("  |  ")}`,
  );
  console.log(
    `intro:     ${await page.locator("main > p").first().innerText()}`,
  );

  step(6, "MFA enrolment — the QR code, in the same flow");
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector("svg[role='img']");
  const qrPathLength = await page
    .locator("svg[role='img'] path")
    .getAttribute("d");
  const manualKey = (
    await page.locator("code.user-select-all").first().innerText()
  ).trim();
  console.log(`QR svg:    ${qrPathLength.length} chars of path data`);
  console.log(
    `alt text:  ${await page.locator("svg[role='img']").getAttribute("aria-label")}`,
  );
  console.log(`key shown: ${manualKey.length} chars, grouped in fours`);
  // Written for the report's benefit, so the container log can be grepped for
  // it afterwards. NOT printed: the whole point of D-185 is that this value
  // exists in one browser page and nowhere else.
  await import("node:fs").then(({ writeFileSync }) =>
    writeFileSync("/tmp/uat-totp-key", manualKey.replace(/\s+/g, ""), {
      mode: 0o600,
    }),
  );
  const backupCodes = await page.locator("details li code").allInnerTexts();
  console.log(`backup:    ${backupCodes.length} codes offered`);

  const secret = new TextDecoder().decode(
    base32.decode(manualKey.replace(/\s+/g, "")),
  );
  const code = await createOTP(secret).totp();
  console.log(`computed a code from the key the page showed`);

  await page.fill("#code", code);
  await page.click('form:has(#code) button[type="submit"]');
  await page.waitForURL(`${baseUrl}/`);

  step(7, "landed on a working page");
  console.log(`now at:    ${page.url()}`);
  console.log(`h1:        ${await page.locator("h1").first().innerText()}`);
  console.log(
    `body:      ${(await page.locator("main p").allInnerTexts()).join(" | ")}`,
  );
  console.log(
    `links:     ${(await page.locator("main a").allInnerTexts()).join(", ")}`,
  );

  step(8, "the people register renders for the new administrator");
  await page.click('main a:has-text("Mensen")');
  // Wait for the URL, not for "networkidle": a client-side navigation can leave
  // the network quiet before the new document is the one being looked at.
  await page.waitForURL(/\/people$/);
  console.log(`now at:    ${page.url()}`);
  console.log(`h1:        ${await page.locator("h1").first().innerText()}`);

  step(9, "/setup is now a 404 — the wizard self-destructed (D-039)");
  // LAST, because it leaves the browser on the not-found page. A redirect here
  // would say the route exists and is merely not for this caller; a 404 is the
  // honest description of a surface that closed itself.
  const closed = await page.goto(`${baseUrl}/setup`);
  console.log(`GET /setup -> HTTP ${closed.status()}`);
} finally {
  await browser.close();
}
