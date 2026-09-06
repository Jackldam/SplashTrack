/**
 * Every screen is escapable, and no future module can ship one that is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE-LEVEL TEST, IN THE SHAPE `route-guard-coverage.test.ts` USES
 *
 * The defect this guards against has already happened once in the other
 * direction: `groups` shipped with no link INTO it, the fix was one line on the
 * landing page, and the comment beside that line asks the next author to
 * remember. A comment is not a mechanism, and the module that forgets is by
 * definition the one nobody is looking at.
 *
 * The way OUT had the same shape. `/people` and `/groups` rendered a heading, a
 * table and a create form, and nothing on either led anywhere but deeper — so
 * the only escape was the browser's own chrome, which on a phone held over a
 * wet tiled floor is a gesture rather than a target.
 *
 * The root layout fixes it structurally: a page cannot render outside it. These
 * assertions keep it that way, because "delete the header from the layout"
 * typechecks, builds, and passes every behavioural test in the suite.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND EVERY PAGE INSIDE A MODULE CARRIES A BREADCRUMB
 *
 * Home is one tap from anywhere; the header guarantees that. But one lesson
 * inside one group is three segments deep, and "home, then back in" is four
 * taps to reach the screen you were just on. So a page inside a module also
 * names its parent — `<nav aria-label="kruimelpad">`, the label the built
 * surfaces already use.
 *
 * A MODULE'S OWN TOP-LEVEL SCREEN (`/people`, `/groups`, `/sign-in`) is exempt,
 * and not by omission: its parent IS the landing page, which is what the header
 * links to. A breadcrumb there would be one link pointing at the link beside it.
 *
 * The allowlist below is for pages that are nested in the route table but not
 * in the user's journey. It is empty today. Adding an entry is legitimate;
 * adding it without the sentence that says why is not.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(process.cwd(), "src/app");

/** Pages inside a module that need no breadcrumb, each with the reason. */
const NO_BREADCRUMB_NEEDED: ReadonlyMap<string, string> = new Map([]);

/** Every `.ts`/`.tsx` file under `src/app`, as paths relative to it. */
function appSourceFiles(directory = APP_DIR, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = path.join(directory, entry);
    const relative = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(absolute).isDirectory()) {
      found.push(...appSourceFiles(absolute, relative));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(relative);
    }
  }
  return found;
}

function read(relative: string): string {
  return readFileSync(path.join(APP_DIR, relative), "utf8");
}

describe("the way back is in the layout", () => {
  it("the root layout renders the header", () => {
    expect(read("layout.tsx")).toMatch(/<AppHeader\s*\/>/);
  });

  it("the header links to the landing page", () => {
    expect(read("app-header.tsx")).toMatch(/href="\/"/);
  });

  it("nothing else claims to be a root layout", () => {
    // A second `<html>` would mean a route tree rendering OUTSIDE the layout
    // that carries the header — the one way a page could escape this rule
    // without anybody deleting anything.
    const roots = appSourceFiles().filter(
      (file) => file !== "layout.tsx" && /<html\b/.test(read(file)),
    );
    expect(roots).toEqual([]);
  });
});

describe("every nested page names its parent", () => {
  it("carries a breadcrumb, or an allowlisted reason not to", () => {
    const offenders = appSourceFiles().filter((file) => {
      if (!/(^|\/)page\.tsx$/.test(file)) return false;
      // `page.tsx` is the landing page and `<module>/page.tsx` is a module's
      // own front door. Both have the landing page as their parent, which is
      // where the header already points.
      if (file.split("/").length < 3) return false;
      if (NO_BREADCRUMB_NEEDED.has(file)) return false;
      return !/aria-label="kruimelpad"/.test(read(file));
    });

    expect(offenders).toEqual([]);
  });

  it("every allowlisted surface still exists", () => {
    // An allowlist entry for a deleted file is an exemption nobody reviews.
    const present = new Set(appSourceFiles());
    for (const file of NO_BREADCRUMB_NEEDED.keys()) {
      expect(present.has(file), `${file} is allowlisted but is gone`).toBe(
        true,
      );
    }
  });
});
