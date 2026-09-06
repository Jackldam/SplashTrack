/**
 * Every capability a module exports can be reached from a screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR, WHICH HAPPENED FIVE TIMES IN ONE DAY
 *
 * A service is written, exported from its module's `index.ts`, covered by
 * tests — and no surface ever calls it. It typechecks, it builds, every test
 * passes, and the club cannot do the thing.
 *
 *   - `createLane` shipped in phase 1.6 with no caller: the club could record
 *     that it has a pool and none of the lanes in it.
 *   - `deactivateRecurrence` shipped in phase 1.6 with no caller: a rule typed
 *     with the wrong weekday could only be worked around by cancelling every
 *     lesson it generated, one at a time, each with a reason.
 *   - `updateClosure`, `updatePool` and the whole of `SessionLane` were the
 *     same shape from the other side — the capability was in the model or the
 *     service layer and nothing reached it.
 *
 * Phase 1.7 named this class and fixed four instances of it. It did not build
 * the check, so phase 1.8 opened with a fifth. `docs/build/phase-1.8-…` §5 says
 * why that ordering was wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT CHECKS, AND WHY THAT LINE
 *
 * Only **application services**, and only the ones that WRITE.
 *
 *   - *Application services*, because `index.ts` groups its re-exports by the
 *     file they come from, and `./application/…` is exactly the layer that
 *     holds capabilities. `./domain/…` is pure functions (`addDays`,
 *     `expandRecurrence`) and `./infrastructure/…` is repositories and
 *     registrations; neither is something a person does, and requiring a screen
 *     to name `resolveTimeZone` would be noise that trains people to extend the
 *     allowlist.
 *   - *That write*, because a read with no caller is a dead query and a write
 *     with no caller is a promise the product does not keep. Every instance of
 *     the defect above was a write. Reads are checked too, but loosely — see
 *     the second test.
 *
 * "Reachable" means the name appears somewhere under `src/app`. Not necessarily
 * in a Server Action: `revealRelationshipEvidence` is called by a page, which is
 * a surface. What it must not be is called only by tests, or by nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ALLOWLIST IS NOT A SUPPRESSION LIST
 *
 * It is empty. An entry needs a sentence saying why a capability legitimately
 * has no surface — and "not built yet" is not such a sentence, because that is
 * precisely the state this test exists to make visible. If a service is ahead
 * of its screen, the honest form is not to export it yet.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(process.cwd(), "src");

/** The domain modules. `audit` is infrastructure every service writes through. */
const MODULES = ["people", "groups", "sessions"] as const;

/**
 * Capabilities with no surface, each with the reason it is legitimate.
 *
 * EMPTY, and it should stay that way. See the file header.
 */
const NO_SURFACE_NEEDED: ReadonlyMap<string, string> = new Map([]);

/**
 * The verbs that make an export a WRITE.
 *
 * A list and not a heuristic: `resolveGuardianAuthority` derives, `hasRoom`
 * asks, `assertMoveIsCoherent` refuses — none of them changes a row, and a
 * regex loose enough to be clever about that would be a regex nobody can
 * predict. When a new write verb enters the vocabulary, it is added here, and
 * the addition is the moment somebody thinks about whether the thing has a
 * screen.
 */
const WRITE_VERBS = [
  "add",
  "assign",
  "cancel",
  "clear",
  "create",
  "deactivate",
  "delete",
  "end",
  "generate",
  "move",
  "override",
  "place",
  "record",
  "remove",
  "revoke",
  "set",
  "start",
  "update",
] as const;

function isWrite(name: string): boolean {
  return WRITE_VERBS.some((verb) => new RegExp(`^${verb}[A-Z]`).test(name));
}

/** Every `.ts`/`.tsx` file under a directory, absolute. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...sourceFiles(absolute));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(absolute);
    }
  }
  return found;
}

/**
 * The value exports of one module's `index.ts`, grouped by the layer they come
 * from.
 *
 * Parsed from the `export { … } from "./layer/file"` blocks rather than by
 * importing the module, because importing it would pull in `@/lib/database` and
 * make a source-level invariant depend on a database connection. It is the same
 * choice `route-guard-coverage.test.ts` and `navigation-shell.test.ts` make.
 */
function exportedCapabilities(moduleName: string): string[] {
  const source = readFileSync(
    path.join(SRC, "modules", moduleName, "index.ts"),
    "utf8",
  );
  const names: string[] = [];
  const block = /export\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = block.exec(source)) !== null) {
    if (!match[2]!.includes("/application/")) continue;
    for (const raw of match[1]!.split(",")) {
      const name = raw.trim();
      // `type Foo` re-exports a shape, not a capability.
      if (name.length === 0 || name.startsWith("type ")) continue;
      names.push(name.split(/\s+as\s+/)[0]!.trim());
    }
  }
  return names;
}

const surfaceSource = sourceFiles(path.join(SRC, "app"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

function isReachedByASurface(name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(surfaceSource);
}

describe("every write a module exports is reachable from a screen", () => {
  it("found capabilities to check (sanity check the parser, not the modules)", () => {
    const all = MODULES.flatMap(exportedCapabilities);
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter(isWrite).length).toBeGreaterThan(10);
    // The five that opened this file, by name. A parser change that quietly
    // stopped seeing them would leave the test green and useless.
    expect(all).toEqual(
      expect.arrayContaining([
        "createLane",
        "deactivateRecurrence",
        "updateClosure",
        "updatePool",
        "setRecurrenceLanes",
      ]),
    );
  });

  it("has a surface calling it, or an allowlisted reason not to", () => {
    const unreachable: string[] = [];
    for (const moduleName of MODULES) {
      for (const name of exportedCapabilities(moduleName)) {
        if (!isWrite(name)) continue;
        if (NO_SURFACE_NEEDED.has(name)) continue;
        if (!isReachedByASurface(name)) {
          unreachable.push(`${moduleName}: ${name}`);
        }
      }
    }

    expect(
      unreachable,
      `${unreachable.join("\n")}\n\nEach of these is exported from a module ` +
        "and called by nothing under src/app. A capability nobody can reach " +
        "is not shipped, whatever the export list says — build the surface, " +
        "or stop exporting it until there is one. See the header of this " +
        "file for the five times this has already happened.",
    ).toEqual([]);
  });

  it("keeps the allowlist tight (every allowlisted capability still exists)", () => {
    // An allowlist entry for a deleted export is an exemption nobody reviews.
    const all = new Set(MODULES.flatMap(exportedCapabilities));
    for (const name of NO_SURFACE_NEEDED.keys()) {
      expect(all.has(name), `${name} is allowlisted but is gone`).toBe(true);
    }
  });
});

describe("and the reads are reachable too, or are deliberately not", () => {
  /**
   * A LOOSER CHECK, ON PURPOSE. A read with no surface is a dead query rather
   * than a broken promise, and some of them are genuinely internal to a module
   * that re-exports them for another module's service — `getStudentGroupHistory`
   * is read by a page, `describeRelationshipAuthority` by one too, but the
   * pattern is not universal and forcing it would be inventing a rule.
   *
   * So this reports rather than fails. It exists because "nothing reaches this"
   * is worth SEEING even when it is not worth refusing, and a count that drifts
   * upward is the signal.
   */
  it("reports how many non-write capabilities no surface reaches", () => {
    const unreached = MODULES.flatMap((moduleName) =>
      exportedCapabilities(moduleName)
        .filter((name) => !isWrite(name))
        .filter((name) => !isReachedByASurface(name))
        .map((name) => `${moduleName}: ${name}`),
    );
    // Not zero and not asserted to be: it is a number to look at when it moves.
    expect(unreached.length).toBeLessThan(40);
  });
});
