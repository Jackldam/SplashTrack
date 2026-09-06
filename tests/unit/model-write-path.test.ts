/**
 * Every table `people`, `groups` and `sessions` own has a write path somewhere
 * in the application.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 *
 * `SessionLane` — the table AND its retention classification — was in
 * `prisma/schema.prisma` since phase 1.6. Nothing ever wrote a row to it: the
 * lane-assignment feature it exists for had no service, so the club could
 * override which lane a lesson used and the override lived nowhere. This is
 * `service-reachability.test.ts`'s defect one layer down — that test would
 * have caught a service with no caller, but a MODEL with no writer needs
 * nobody to have written the service at all, so no export exists for that test
 * to check. The gap is invisible to it by construction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONLY `people` / `groups` / `sessions`, THE SAME SCOPE
 * `service-reachability.test.ts` USES
 *
 * `prisma/schema.prisma` also carries identity (`UserAccount`, `Session`,
 * `Account`, `Verification`, `TwoFactor`, `Passkey` — Better Auth's own
 * tables), authorization and audit infrastructure, and a couple of tables the
 * design says to keep "in place, unused" on purpose (see below). None of that
 * is something built on top of `people`/`groups`/`sessions` operates by
 * writing directly — it is the plumbing those three modules write THROUGH, the
 * same distinction `service-reachability.test.ts`'s header draws for
 * `resolveTimeZone`. Holding infrastructure to "a person can trigger a write
 * from a screen" would be inventing a rule the design never made; holding the
 * three domain modules to it is exactly rebuilding the SessionLane defect on
 * purpose, once, in a test.
 *
 * `DOMAIN_MODELS` is therefore a literal list, checked below against the
 * schema so a rename cannot silently drop a model out of scope.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS "A WRITE PATH"
 *
 * Either an ORM call — `prisma.<model>.create` or `tx.<model>.update`, etc.,
 * for any client variable name — or a raw SQL `INSERT INTO`/`UPDATE` naming the
 * table, because `RateLimitCounter`'s single writer is a hand-written
 * `INSERT ... ON CONFLICT` (`src/lib/rate-limit/rate-limit.ts`) for the
 * atomicity a read-then-write pair cannot give it. Scanned across
 * `src/modules`, `src/lib`, `src/app` and `src/cli` — `src/cli` counts because
 * `splashtrack admin` is a real operator surface, not a screen but no less a
 * way the capability is reached (`src/cli/commands/admin.ts` writes
 * `UserAccount`/`TwoFactor`/`RoleAssignment` this way). `src/generated` (the
 * Prisma client) is excluded: it mechanically defines every method for every
 * model, so scanning it would make this test pass no matter what the
 * application code does — the exact "always green" failure mode this suite
 * exists to avoid. Test fixtures under `tests/` are excluded for the same
 * reason `service-reachability.test.ts` excludes test-only callers: a model
 * only a fixture writes to is not reachable from the product.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ALLOWLIST IS NOT A SUPPRESSION LIST
 *
 * Empty today (`DOMAIN_MODELS` currently scoped away from every table that
 * would need one). An entry needs a reason as concrete as
 * `service-reachability.test.ts` demands — "not built yet" does not qualify
 * there and does not qualify here either.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractModelBlocks } from "./prisma-schema-parser";

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "prisma", "schema.prisma");

/**
 * The tables `people`, `groups` and `sessions` own. See the file header for
 * why this is the same three-module scope `service-reachability.test.ts` uses,
 * and why identity/authorization/audit tables are not held to this standard.
 */
const DOMAIN_MODELS = [
  // people
  "Person",
  "Membership",
  "MembershipPeriod",
  "StudentProfile",
  "StudentLifecycleEvent",
  "PersonRelationship",
  // groups
  "Group",
  "GroupMembership",
  "GroupMove",
  "InstructorAssignment",
  "Pool",
  "Lane",
  // sessions
  "SessionRecurrence",
  "RecurrenceLane",
  "ScheduleException",
  "ScheduledSession",
  "SessionLane",
  "SessionRosterEntry",
] as const;

/** Tables with no application write path, each with the reason it is legitimate. */
const NO_WRITE_PATH_NEEDED: ReadonlyMap<string, string> = new Map([]);

const WRITE_METHODS = [
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
] as const;

function toCamel(modelName: string): string {
  return modelName[0]!.toLowerCase() + modelName.slice(1);
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
 * Production source only: the four directories a write could legitimately live
 * in, `src/generated` (the Prisma client itself) excluded. See the file header
 * for why scanning the generated client would make this test unconditionally
 * pass.
 */
const PRODUCTION_SOURCE = ["src/modules", "src/lib", "src/app", "src/cli"]
  .map((dir) => path.join(ROOT, dir))
  .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory())
  .flatMap(sourceFiles)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

function hasWritePath(modelName: string): boolean {
  const camel = toCamel(modelName);
  const ormCall = new RegExp(
    `\\b(?:prisma|tx|client)\\.${camel}\\.(?:${WRITE_METHODS.join("|")})\\b`,
  );
  const rawSql = new RegExp(`(?:INSERT\\s+INTO|UPDATE)\\s+"?${modelName}"?\\b`, "i");
  return ormCall.test(PRODUCTION_SOURCE) || rawSql.test(PRODUCTION_SOURCE);
}

describe("every table people/groups/sessions own has a write path", () => {
  const schemaModels = extractModelBlocks(readFileSync(SCHEMA_PATH, "utf8"));

  it("DOMAIN_MODELS names models that actually exist in the schema", () => {
    const missing = DOMAIN_MODELS.filter((name) => !schemaModels.has(name));
    expect(missing, `${missing.join(", ")} not found in prisma/schema.prisma — DOMAIN_MODELS has drifted from the schema.`).toEqual([]);
  });

  it("has a write path, or an allowlisted reason not to", () => {
    const noWritePath = DOMAIN_MODELS.filter(
      (name) => !NO_WRITE_PATH_NEEDED.has(name) && !hasWritePath(name),
    );
    expect(
      noWritePath,
      `${noWritePath.join("\n")}\n\nEach of these tables is in prisma/schema.prisma ` +
        "and nothing under src/modules, src/lib, src/app or src/cli writes to " +
        "it — the SessionLane defect: a capability modeled in the schema that " +
        "the application never reaches. See this file's header for the story.",
    ).toEqual([]);
  });

  it("keeps the allowlist tight (every allowlisted model is still in scope)", () => {
    for (const name of NO_WRITE_PATH_NEEDED.keys()) {
      expect(
        (DOMAIN_MODELS as readonly string[]).includes(name),
        `${name} is allowlisted but is not in DOMAIN_MODELS`,
      ).toBe(true);
    }
  });
});
