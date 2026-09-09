/**
 * Every page under `src/app` is reachable by following links, starting at `/`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 *
 * `/groups` shipped complete — route, page, forms, all of it — with no link
 * INTO it from anywhere a signed-in user could get to. It typechecked, it
 * built, `service-reachability.test.ts` was green (every service `/groups`
 * called had a caller — inside `/groups` itself), and the club could not find
 * the module. The fix was one `<Link>` on the landing page
 * (`docs/build/phase-1.1-people-module-report.md`), and the comment beside it
 * asks the next author to remember. `navigation-shell.test.ts` mechanises the
 * way OUT of a page (the header, the breadcrumb); nothing mechanised the way
 * IN. This test is that other half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT "REACHABLE" MEANS HERE
 *
 * A directed graph: every file under `src/app` belongs to the nearest route
 * that owns it (the nearest ancestor directory with a `page.tsx`; a file at
 * `src/app`'s own top level — the root layout, the header, `page.tsx` itself —
 * belongs to `/`, because it renders on every request). An edge from route A to
 * route B exists when a file owned by A contains a `<Link href>` or a
 * `redirect()` call naming B.
 *
 * Dynamic segments (`[groupId]`) cannot be resolved statically, so a link is
 * matched to a route PATTERN: `${group.id}` becomes a wildcard, and it must
 * line up, segment for segment, with a `[param]` in the route. `href="/groups"`
 * does NOT satisfy `/groups/[groupId]` (different length) and does not spill
 * over into matching `/groups/pools` either — segments are compared whole, not
 * as a prefix.
 *
 * Named path constants (`MFA_ENROLMENT_PATH`) are resolved from their
 * `export const X = "/…"` declaration, because `href={MFA_ENROLMENT_PATH}` is
 * exactly as real a link as `href="/mfa-enrolment"` and a textual scan that
 * only understood quoted strings would call the enrolment screen unreachable.
 *
 * A route reachable from `/` by this graph is a route a real click sequence
 * can reach. It is not a claim about auth-gating (a route can be reachable and
 * still refuse the caller) — that is `route-guard-coverage.test.ts`'s job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ALLOWLIST IS NOT A SUPPRESSION LIST
 *
 * Empty, and it should stay that way — see `service-reachability.test.ts`'s
 * header for why "not linked yet" is not a legitimate entry.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(process.cwd(), "src");
const APP_DIR = path.join(SRC, "app");
const ROOT = "/";

/** Every `.ts`/`.tsx` file under a directory, absolute, `api/` excluded. */
function appFiles(directory = APP_DIR): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    if (entry === "api") continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...appFiles(absolute));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(absolute);
    }
  }
  return found;
}

/** Every directory under `src/app` (`api/` excluded) that has its own `page.tsx`. */
function pageDirectories(directory = APP_DIR, found: string[] = []): string[] {
  if (readdirSync(directory).includes("page.tsx")) found.push(directory);
  for (const entry of readdirSync(directory).sort()) {
    if (entry === "api") continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) pageDirectories(absolute, found);
  }
  return found;
}

/** A directory's route pattern, `[param]` segments kept literal, e.g. `/groups/[groupId]`. */
function routePatternOf(directory: string): string {
  const relative = path.relative(APP_DIR, directory).split(path.sep).join("/");
  return relative.length === 0 ? ROOT : `/${relative}`;
}

const ROUTE_PATTERNS = pageDirectories().map(routePatternOf);

/**
 * The route that OWNS a file: the nearest ancestor directory with its own
 * `page.tsx`, or `/` for anything at `src/app`'s own top level (the layout and
 * the header render on every route, so a link there is reachable from `/`
 * directly).
 */
function owningRouteOf(filePath: string): string {
  let directory = path.dirname(filePath);
  while (directory.startsWith(APP_DIR)) {
    if (readdirSync(directory).includes("page.tsx")) {
      return routePatternOf(directory);
    }
    if (directory === APP_DIR) return ROOT;
    directory = path.dirname(directory);
  }
  return ROOT;
}

/** `export const NAME = "/…"` — a named path constant, resolved wherever it is declared. */
function pathConstants(): ReadonlyMap<string, string> {
  const constants = new Map<string, string>();
  const pattern = /export const ([A-Z][A-Z0-9_]*)\s*=\s*"(\/[^"]*)"/g;
  for (const file of appFiles(SRC)) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      constants.set(match[1]!, match[2]!);
    }
  }
  return constants;
}

const PATH_CONSTANTS = pathConstants();

/** Balanced-delimiter spans starting right after `head`, e.g. the `{...}` in `href={...}`. */
function balancedSpansAfter(
  source: string,
  head: RegExp,
  open: string,
  close: string,
): string[] {
  const spans: string[] = [];
  const pattern = new RegExp(head, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const start = match.index + match[0].length;
    if (source[start - 1] !== open) continue;
    let depth = 1;
    let i = start;
    while (depth > 0 && i < source.length) {
      if (source[i] === open) depth++;
      else if (source[i] === close) depth--;
      i++;
    }
    spans.push(source.slice(start, i - 1));
  }
  return spans;
}

/** Every internal path this expression could resolve to: literals, templates, known constants. */
function candidatePaths(expression: string): string[] {
  const found: string[] = [];
  const literal = /"(\/[^"]*)"|'(\/[^']*)'|`(\/[^`]*)`/g;
  let match: RegExpExecArray | null;
  while ((match = literal.exec(expression)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3])!;
    const normalized = raw.replace(/\$\{[^}]*\}/g, "*").split(/[?#]/)[0]!;
    found.push(normalized);
  }
  for (const [name, value] of PATH_CONSTANTS) {
    if (new RegExp(`\\b${name}\\b`).test(expression)) found.push(value);
  }
  return found;
}

/** Every internal navigation target named anywhere in `source` (`href={…}` and `redirect(…)`). */
function linksIn(source: string): string[] {
  const targets: string[] = [];
  for (const span of balancedSpansAfter(source, /href\s*=\s*\{/, "{", "}")) {
    targets.push(...candidatePaths(span));
  }
  for (const match of source.matchAll(
    /href\s*=\s*("(\/[^"]*)"|'(\/[^']*)')/g,
  )) {
    targets.push(...candidatePaths(match[1]!));
  }
  for (const span of balancedSpansAfter(source, /redirect\s*\(/, "(", ")")) {
    targets.push(...candidatePaths(span));
  }
  return targets;
}

/** Does this normalized path (`*` for a resolved dynamic segment) match this route pattern? */
function matchesRoute(target: string, routePattern: string): boolean {
  if (target === ROOT && routePattern === ROOT) return true;
  const targetSegments = target.split("/").filter(Boolean);
  const routeSegments = routePattern.split("/").filter(Boolean);
  if (targetSegments.length !== routeSegments.length) return false;
  return routeSegments.every((routeSegment, i) => {
    const targetSegment = targetSegments[i]!;
    if (/^\[.*\]$/.test(routeSegment)) return true;
    return targetSegment === routeSegment;
  });
}

/** Every allowlisted route, each with the reason it is exempt from this check. */
const NO_LINK_NEEDED: ReadonlyMap<string, string> = new Map([]);

function buildReachableSet(): Set<string> {
  const edges = new Map<string, Set<string>>();
  for (const file of appFiles()) {
    const owner = owningRouteOf(file);
    const source = readFileSync(file, "utf8");
    for (const target of linksIn(source)) {
      for (const route of ROUTE_PATTERNS) {
        if (matchesRoute(target, route)) {
          if (!edges.has(owner)) edges.set(owner, new Set());
          edges.get(owner)!.add(route);
        }
      }
    }
  }

  const reachable = new Set<string>([ROOT]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [from, tos] of edges) {
      if (!reachable.has(from)) continue;
      for (const to of tos) {
        if (!reachable.has(to)) {
          reachable.add(to);
          grew = true;
        }
      }
    }
  }
  return reachable;
}

describe("every page under src/app is reachable from / by following links", () => {
  it("found routes to check (sanity check the parser, not the app)", () => {
    expect(ROUTE_PATTERNS.length).toBeGreaterThan(8);
    expect(ROUTE_PATTERNS).toEqual(
      expect.arrayContaining(["/", "/groups", "/groups/pools", "/people"]),
    );
  });

  it("is reachable from /, or is allowlisted with a reason", () => {
    const reachable = buildReachableSet();
    const unreachable = ROUTE_PATTERNS.filter(
      (route) => !reachable.has(route) && !NO_LINK_NEEDED.has(route),
    );
    expect(
      unreachable,
      `${unreachable.join("\n")}\n\nEach of these routes has a page and no ` +
        "link from any route reachable from / — the /groups defect, one " +
        "level up. A route nobody can click to is not shipped, whatever the " +
        "file tree says.",
    ).toEqual([]);
  });

  it("keeps the allowlist tight (every allowlisted route still exists)", () => {
    const present = new Set(ROUTE_PATTERNS);
    for (const route of NO_LINK_NEEDED.keys()) {
      expect(present.has(route), `${route} is allowlisted but is gone`).toBe(
        true,
      );
    }
  });
});
