/**
 * Nothing under `src/app` reaches for the WEAK session helper by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE-LEVEL TEST AND NOT ONLY A BEHAVIOURAL ONE
 *
 * D-185 requires that an account inside the MFA enrolment window can do exactly
 * two things: sign in, and enrol. `requireEnrolledSession()` is what enforces
 * that for pages and Server Actions, and `getCurrentSession()` is the same
 * lookup WITHOUT the refusal — the right tool for the handful of surfaces that
 * must render for a half-enrolled account, and the wrong one everywhere else.
 *
 * The failure mode is not a bug in the guard; it is a screen added six months
 * from now that calls the weaker helper because it was the first one in the
 * import list. No behavioural test can catch that, because the screen it would
 * have to exercise does not exist yet. This one does, by making the allowlist
 * below the only place the decision can be made — a new entry is a line in a
 * diff a reviewer sees.
 *
 * Adding a file here is legitimate. Adding it WITHOUT the sentence explaining
 * why that surface must serve a pending account is not.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { decideRouteAccess, type CurrentSession } from "@/lib/auth/session";
import { MFA_ENROLMENT_PATH } from "@/lib/auth/mfa-enrolment";

const APP_DIR = path.resolve(process.cwd(), "src/app");

/**
 * The surfaces that may call `getCurrentSession()` directly, each with the
 * reason it cannot use the guard.
 */
const MAY_USE_UNGUARDED_SESSION: ReadonlyMap<string, string> = new Map([
  [
    "page.tsx",
    "The landing page renders for anonymous visitors, for pending accounts " +
      "(it shows them where to enrol) and for enrolled ones. It is the one " +
      "page whose whole job is to differ by state.",
  ],
  [
    "sign-in/page.tsx",
    "Bounces an ALREADY signed-in caller away from the sign-in form. Sending " +
      "a pending account to the guard here would redirect it to enrolment, " +
      "which is where it is going anyway — but the check has to run before " +
      "the form renders, for a session that may not exist at all.",
  ],
  [
    "break-glass-banner.tsx",
    "Renders nothing for a pending account rather than redirecting: it is a " +
      "component inside the landing page, and a redirect from here would " +
      "take the landing page with it.",
  ],
  [
    "mfa-enrolment/page.tsx",
    "THE enrolment page. It exists precisely to serve a pending account, so " +
      "it is the one surface for which the guard's refusal would be a loop.",
  ],
  [
    "mfa-enrolment/actions.ts",
    "The enrolment Server Actions, for the same reason. They apply their own " +
      "refusal — a session that is NOT pending is sent away from them.",
  ],
  [
    "setup/page.tsx",
    "The first-run wizard (D-187). Its LAST step is MFA enrolment, so the " +
      "caller it exists for is precisely an account with no verified factor — " +
      "the guard would bounce it to /mfa-enrolment, which is the step this " +
      "page renders. Its own gate is STRICTER than the guard rather than " +
      "weaker: the boot state decides whether the page exists at all, and the " +
      "session is consulted only in PENDING_ENROLMENT, where an anonymous " +
      "caller is sent to sign in. See src/lib/setup/gate.ts.",
  ],
]);

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

describe("route guard coverage", () => {
  it("only allowlisted surfaces use the unguarded session helper", () => {
    const offenders = appSourceFiles().filter((file) => {
      if (MAY_USE_UNGUARDED_SESSION.has(file)) return false;
      const source = readFileSync(path.join(APP_DIR, file), "utf8");
      return /\bgetCurrentSession\b/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("every allowlisted surface still exists", () => {
    // An allowlist entry for a deleted file is an exemption nobody is
    // reviewing any more.
    const present = new Set(appSourceFiles());
    for (const file of MAY_USE_UNGUARDED_SESSION.keys()) {
      expect(
        present.has(file),
        `${file} is allowlisted but does not exist`,
      ).toBe(true);
    }
  });
});

/** A session shaped like a real one; only the fields under test matter here. */
function sessionWith(mfaPending: boolean): CurrentSession {
  return {
    sessionId: "session",
    expiresAt: new Date(Date.now() + 60_000),
    userAccount: {
      id: "account",
      email: "someone@example.invalid",
      status: "ACTIVE",
      personId: "person",
    },
    person: { id: "person", givenName: "Test", familyName: "Persoon" },
    mfaPending,
  };
}

describe("decideRouteAccess", () => {
  it("sends an anonymous caller to sign in", () => {
    expect(decideRouteAccess(null)).toEqual({
      allow: false,
      redirectTo: "/sign-in",
    });
  });

  it("sends a pending account to enrolment", () => {
    expect(decideRouteAccess(sessionWith(true))).toEqual({
      allow: false,
      redirectTo: MFA_ENROLMENT_PATH,
    });
  });

  it("allows an account with a verified factor", () => {
    expect(decideRouteAccess(sessionWith(false))).toEqual({ allow: true });
  });

  it("treats a fixture that never mentions MFA as enrolled", () => {
    // `mfaPending` is optional on the type so hand-built fixtures need not set
    // it. `undefined` must mean "ordinary session", not "pending" — the other
    // reading would make every existing test fixture unable to reach a page.
    const withoutFlag: CurrentSession = sessionWith(false);
    delete withoutFlag.mfaPending;
    expect(decideRouteAccess(withoutFlag)).toEqual({ allow: true });
  });
});
