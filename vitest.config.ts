import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/*
 * Two test projects, split by environment:
 *
 *   • "node"  — the unit + integration suite. Runs in a Node environment and
 *     talks to the isolated `<dev-db-name>_test` database. This is the bulk of
 *     the suite: business rules, permissions, pure helpers, and — once phase
 *     0.4 lands the scope model — the scope-escape suite that
 *     `06-delivery.md` §2.1 calls the most important gate in the pipeline.
 *
 *   • "dom"   — presentational component tests, in jsdom with
 *     @testing-library/react. These never touch the database, so they carry
 *     NONE of the node project's setup. Component tests are identified by
 *     WHERE THE COMPONENT LIVES — both `src/components/**` and a module's own
 *     `ui/` folder — so a widget owned by a module still gets a real DOM
 *     rather than failing with "document is not defined" in the node project.
 *
 * The dom project matches nothing yet: phase 0.2 ships no components. It is
 * configured now so the first one does not arrive alongside a config change.
 *
 * Playwright (`playwright.config.ts`) is a separate suite and the two must
 * never overlap: every Playwright spec is named `*.spec.ts`, never `*.test.ts`,
 * and `tests/e2e/**` is excluded below as belt and braces.
 */
export default defineConfig({
  // tsconfigPaths resolves the `@/*` alias in both projects; the React plugin
  // provides the JSX/runtime transform the jsdom component tests need (and is
  // inert for the Node project).
  plugins: [tsconfigPaths(), react()],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          globals: false,
          // Runs BEFORE any test module: pins DATABASE_URL to the isolated
          // `<dev-db-name>_test` database and refuses to run against dev or
          // production. See tests/setup/test-env.ts.
          setupFiles: ["./tests/setup/test-env.ts"],
          // Integration tests share ONE real database and some of them will
          // mutate singleton tables (Organization) or truncate the audit
          // trail. Running test FILES in parallel against that shared state is
          // racy, so file execution is serialized and the suite is
          // deterministic. Revisit only with per-file database isolation.
          fileParallelism: false,
          include: [
            "tests/**/*.test.ts",
            "tests/**/*.test.tsx",
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
          ],
          // Component render/interaction tests belong to the "dom" project.
          // Under `src/app` that split follows the EXTENSION: `.test.tsx`
          // renders UI (jsdom), `.test.ts` tests server/database code (node).
          // Keep route-level server tests in `.test.ts` or they run without the
          // database env — which fails loudly rather than silently.
          exclude: [
            "src/components/**/*.test.tsx",
            "src/modules/**/ui/**/*.test.tsx",
            "src/app/**/*.test.tsx",
            "tests/e2e/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          globals: false,
          // Registers jest-dom matchers and per-test cleanup; no database env.
          setupFiles: ["./tests/setup/jsdom-setup.ts"],
          include: [
            "src/components/**/*.test.tsx",
            "src/modules/**/ui/**/*.test.tsx",
            "src/app/**/*.test.tsx",
          ],
        },
      },
    ],
  },
});
