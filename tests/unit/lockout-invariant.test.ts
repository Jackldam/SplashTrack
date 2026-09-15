import { describe, expect, it } from "vitest";

import {
  checkLockoutInvariant,
  lockoutInvariantHolds,
} from "@/modules/settings";

describe("D-141's lockout invariant, as a pure predicate", () => {
  it("holds with exactly one qualifying account", () => {
    expect(lockoutInvariantHolds({ qualifyingAccounts: 1 })).toBe(true);
  });

  it("holds with more than one qualifying account", () => {
    expect(lockoutInvariantHolds({ qualifyingAccounts: 5 })).toBe(true);
  });

  it("does NOT hold with zero qualifying accounts", () => {
    expect(lockoutInvariantHolds({ qualifyingAccounts: 0 })).toBe(false);
  });

  it("checkLockoutInvariant reports both the verdict and the count", () => {
    expect(checkLockoutInvariant({ qualifyingAccounts: 0 })).toEqual({
      holds: false,
      qualifyingAccounts: 0,
    });
    expect(checkLockoutInvariant({ qualifyingAccounts: 2 })).toEqual({
      holds: true,
      qualifyingAccounts: 2,
    });
  });
});
