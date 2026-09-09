/**
 * Playwright configuration.
 *
 * WHY THIS EXISTS, in the template's words and for the same reason here: a
 * production-only render crash reached a deployed environment undetected
 * because nothing in the pipeline loaded a page in a real browser against a
 * real production build. Every spec therefore runs against `next build && next
 * start`, NEVER `next dev` — the bug class this exists to catch does not
 * reproduce under dev mode's more lenient module resolution.
 *
 * `06-delivery.md` §2.1 adds a requirement the template does NOT satisfy and
 * this config cannot fix on its own: axe accessibility assertions are a blocking
 * check, and grep finds axe only in prose. They arrive with the first real
 * screen.
 *
 * There is no spec yet — phase 0.2 ships no UI. The harness is configured now
 * so the first screen arrives with a test rather than with a config change, and
 * `globalSetup` is deliberately absent: the template's seeded personas and
 * `storageState` minting belong with the accounts and roles they seed, which do
 * not exist here.
 *
 * Isolation from the vitest suite: `testMatch` below only ever looks at
 * `*.spec.ts` under `tests/e2e`, and every vitest file is `*.test.ts(x)`. The
 * glob families never overlap.
 */
import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3001";
const baseURL = process.env.BETTER_AUTH_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // The competitor is pen and paper, on a tablet, at the poolside. A browser
    // matrix beyond Chromium is listed in `06-delivery.md` §2.1 as a required
    // addition that nothing gates today; it belongs here once there is a screen
    // worth running it against.
  ],
  webServer: {
    // Production build only — see the file comment.
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
