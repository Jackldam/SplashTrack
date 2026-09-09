import { describe, expect, it } from "vitest";

import * as authorization from "@/lib/authorization";
import {
  assertIsReach,
  ForgedReachError,
  isReach,
  reachVariant,
  type Reach,
} from "@/lib/authorization";

/**
 * `06-delivery.md` §2.1 makes "a `Reach` **cannot be constructed outside
 * `resolveReach()`**" a per-module gate, asserted **structurally, not by
 * convention**. This file is that assertion for the mechanism itself.
 *
 * It holds at three levels, because each one alone has a known escape:
 *
 *   1. **Compile time.** The brand is a non-exported `unique symbol` field, so
 *      no call site can write the property key. `TYPE_LEVEL_PROOF` below fails
 *      `tsc --noEmit` — a Definition-of-Done check — if the brand is ever
 *      dropped from the type. Escape: a `value as Reach` assertion, which
 *      TypeScript permits for a sufficiently overlapping object.
 *   2. **Run time.** The same symbol is a real property, so the cast above is
 *      caught by `assertIsReach` at the point of use rather than silently
 *      widening a query. Escape: copying a genuine reach and editing the copy.
 *   3. **The copy path.** `reachVariant` strips the brand, so the natural
 *      spread — `{ ...reachVariant(r), kind: "ORGANIZATION" }` — produces an
 *      ordinary object that fails (2).
 *
 * D-031 claimed a required argument "turns a silent over-fetch into a type
 * error". A required argument enforces PRESENCE; `{units: [], groups: [], all:
 * true}` was a valid literal TypeScript would accept anywhere a reach was
 * required. The compiler was checking that the question was asked, not that it
 * was answered by the authority. F-112.
 */

/**
 * COMPILE-TIME PROOF. If the brand is removed from `Reach`, a plain literal
 * becomes assignable, this type becomes `false`, and the line below stops
 * compiling. `npx tsc --noEmit` is a blocking check, so the guard is real.
 */
type LiteralIsNotAReach = { kind: "ORGANIZATION" } extends Reach ? false : true;
const TYPE_LEVEL_PROOF: LiteralIsNotAReach = true;

/** The full public surface. Adding an export is a deliberate, reviewed change. */
const EXPECTED_EXPORTS = [
  // permissions
  "PERMISSION_CATALOGUE",
  "PERMISSIONS",
  "HIGH_RISK_PERMISSIONS",
  "HIGH_RISK_PREFIXES",
  "SELF_PERMISSIONS",
  "SELF_PERMISSION_GAP",
  "asPermissionKey",
  "holdsHighRiskPermission",
  // scope
  "SCOPE_TYPES",
  "SELF_IMPLIED_SCOPE_TYPES",
  "BOUNDED_WINDOW_SCOPE_TYPES",
  "WINDOW_CEILING_DAYS_PAST_REFERENT",
  "InvalidResourceRefError",
  "describeResourceRef",
  "normaliseResourceRef",
  // reach — note that the ONLY producer here is `resolveReach`
  "ForgedReachError",
  "assertIsReach",
  "describeReach",
  "holdsAnyHighRiskPermission",
  "isEmptyReach",
  "isReach",
  "reachVariant",
  "resolveReach",
  // coverage and the guard
  "coversResource",
  "PermissionDeniedError",
  "requirePermission",
  // grants
  "GrantRefusedError",
  "assertGrantable",
  // the relation port
  "SCOPE_RELATION_NAMES",
  "ScopeRelationUnavailableError",
  "configureScopeRelations",
  "resetScopeRelations",
  "scopeRelations",
].sort();

describe("Reach is opaque (D-147)", () => {
  it("holds the compile-time brand", () => {
    // The assertion that matters happened in `tsc`; this keeps the constant
    // referenced so it cannot be deleted as dead code.
    expect(TYPE_LEVEL_PROOF).toBe(true);
  });

  it("exports no constructor — the whole public surface is enumerated", () => {
    // `resolveReach` is the only name here that produces a `Reach`. Any new
    // export must be added deliberately, which is the review this list buys.
    expect(Object.keys(authorization).sort()).toEqual(EXPECTED_EXPORTS);
  });

  it("REFUSES a hand-built literal at run time", () => {
    const forged = { kind: "ORGANIZATION" } as unknown as Reach;
    expect(isReach(forged)).toBe(false);
    expect(() => assertIsReach(forged)).toThrow(ForgedReachError);
    expect(() => reachVariant(forged)).toThrow(ForgedReachError);
  });

  it("REFUSES the widening shapes the old signature invited", () => {
    // `{all: true}` was the 17:00-on-an-exam-Saturday fix (F-112). It is not a
    // Reach, it never was, and there is no field it could set.
    for (const shape of [
      { units: [], groups: [], all: true },
      { kind: "UNION", of: [] },
      { kind: "SESSIONS", sessionIds: ["anything"] },
      {},
      null,
      "ORGANIZATION",
    ]) {
      expect(isReach(shape as unknown)).toBe(false);
    }
  });

  it("REFUSES a copy of a genuine reach with an edited discriminant", () => {
    // The escape a purely type-level brand leaves open, closed by `reachVariant`
    // stripping the brand before it hands the variant out.
    const genuine = Object.freeze({
      kind: "SELF",
      personId: "someone",
    }) as unknown as Reach;
    const widened = { ...genuine, kind: "ORGANIZATION" };
    expect(isReach(widened)).toBe(false);
  });
});
