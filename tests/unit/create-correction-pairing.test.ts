/**
 * Every screen that creates a record also has a way to correct one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 *
 * `updateClosure` and `updateRecurrence` did not exist for a season each: the
 * form to close the pool for a fortnight, or to set up a Tuesday lesson, was
 * built the day the club needed to CREATE one, and the day somebody typed the
 * wrong month or the wrong weekday there was no screen to fix it — cancel every
 * generated lesson one at a time, each with its own reason, was the only way
 * out. All the columns needed for the fix already existed; only the mutation
 * and the form did not (`docs/build/phase-1.8-…` §5, `docs/build/phase-1.9-…`,
 * D-191). `service-reachability.test.ts` cannot see this shape: an export that
 * does not exist yet has nothing to be unreachable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CHECKS
 *
 * Every exported Server Action named `create<Noun>Action` needs a sibling
 * `update<Noun>Action` for the SAME noun, somewhere under `src/app`. It is
 * deliberately a naming convention, not a semantic understanding of what
 * "correctable" means — the same trade `service-reachability.test.ts` makes
 * with its `WRITE_VERBS` list. `create`/`update` is the vocabulary this
 * codebase already uses for the pair (`createClosure`/`updateClosure`,
 * `createRecurrence`/`updateRecurrence`, `createPool`/`updatePool`,
 * `createLane`/`updateLane`, `createGroup`/`updateGroup`,
 * `createPerson`/`updatePerson`), so a missing `update<Noun>Action` is either a
 * genuine gap or a screen that names its correction path with a different
 * verb — and the second case is exactly what the allowlist is for, with the
 * verb it actually uses named in the reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ALLOWLIST IS NOT A SUPPRESSION LIST, AND THIS ONE IS NOT EMPTY
 *
 * `Membership` and `StudentProfile` are not listed here, and that is the
 * point: `createMembershipAction` writes a `memberNumber` an administrator
 * types by hand (`prisma/schema.prisma`'s own comment on the column calls it
 * "administrator-supplied"), and `createStudentProfileAction` writes a
 * `studentNumber` the same way. Neither has ANY correction path today, under
 * this name or another — grep `updateMembership`, `correctMembership`,
 * `updateStudentProfile` and every CLI command in `src/cli/commands/admin.ts`,
 * all come back empty. A typo in either number, once saved, cannot be fixed
 * without touching the database directly. This is the same class of defect as
 * `updateClosure`'s absence, found by the same kind of check, in a module this
 * incident did not touch. It is reported here, not silently allowlisted: "no
 * correction path exists yet" is not a legitimate entry, by this suite's own
 * rule for `service-reachability.test.ts`'s allowlist, and inventing one for
 * this file just to make it green would be exactly the "always passes" test
 * this whole suite exists to not be. Fixing it means shipping
 * `updateMembershipAction` / `updateStudentProfileAction` and their forms — a
 * real change, out of scope for a test file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(process.cwd(), "src/app");

/** Nouns with a `create<Noun>Action` but no `update<Noun>Action`, each with why that's fine. */
const NO_CORRECTION_NEEDED: ReadonlyMap<string, string> = new Map([]);

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

const APP_SOURCE = sourceFiles(APP_DIR)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

/** Every `<verb><Noun>Action` exported anywhere under src/app, split into verb and noun. */
function exportedActions(): Array<{ verb: string; noun: string }> {
  const pattern = /export\s+async\s+function\s+([a-z][a-zA-Z]*)Action\s*\(/g;
  const actions: Array<{ verb: string; noun: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(APP_SOURCE)) !== null) {
    const name = match[1]!;
    for (const verb of ["create", "update"] as const) {
      if (new RegExp(`^${verb}[A-Z]`).test(name)) {
        actions.push({ verb, noun: name.slice(verb.length) });
      }
    }
  }
  return actions;
}

describe("every create<Noun>Action has an update<Noun>Action", () => {
  const actions = exportedActions();
  const createdNouns = new Set(
    actions.filter((a) => a.verb === "create").map((a) => a.noun),
  );
  const updatedNouns = new Set(
    actions.filter((a) => a.verb === "update").map((a) => a.noun),
  );

  it("found actions to check (sanity check the parser, not the app)", () => {
    expect(createdNouns.size).toBeGreaterThan(5);
    expect([...createdNouns]).toEqual(
      expect.arrayContaining(["Closure", "Recurrence", "Pool", "Lane"]),
    );
  });

  it("has an update<Noun>Action, or an allowlisted reason not to", () => {
    const uncorrectable = [...createdNouns].filter(
      (noun) => !updatedNouns.has(noun) && !NO_CORRECTION_NEEDED.has(noun),
    );
    expect(
      uncorrectable,
      `${uncorrectable.join(", ")}\n\nEach of these has a create${uncorrectable[0] ?? "X"}Action ` +
        "and no update<Noun>Action anywhere under src/app — a typo made at " +
        "creation has no way back. See this file's header for why " +
        "Membership/StudentProfile are reported here rather than allowlisted.",
    ).toEqual([]);
  });

  it("keeps the allowlist tight (every allowlisted noun still has a create action)", () => {
    for (const noun of NO_CORRECTION_NEEDED.keys()) {
      expect(
        createdNouns.has(noun),
        `${noun} is allowlisted but create${noun}Action is gone`,
      ).toBe(true);
    }
  });
});
