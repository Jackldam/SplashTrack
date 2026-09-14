import { describe, expect, it } from "vitest";

import {
  generateRecoveryToken,
  InvalidRecoveryTokenError,
  parseRecoveryToken,
} from "@/lib/crypto/recovery-token";

describe("recovery token (D-115)", () => {
  it("generates a token in the STK1-XXXX-… shape with ≥128 bits of entropy", () => {
    const token = generateRecoveryToken();
    expect(token.formatted).toMatch(/^STK1-([0-9A-Z]{4}-){8}[0-9A-Z*~$=U]$/);
    expect(token.raw.length * 8).toBeGreaterThanOrEqual(128);
  });

  it("round-trips through parseRecoveryToken", () => {
    const token = generateRecoveryToken();
    const parsed = parseRecoveryToken(token.formatted);
    expect(parsed.raw).toEqual(token.raw);
    expect(parsed.formatted).toBe(token.formatted);
  });

  it("is case-insensitive and tolerant of surrounding whitespace", () => {
    const token = generateRecoveryToken();
    const parsed = parseRecoveryToken(`  ${token.formatted.toLowerCase()}  `);
    expect(parsed.raw).toEqual(token.raw);
  });

  it("never generates the same token twice", () => {
    const a = generateRecoveryToken();
    const b = generateRecoveryToken();
    expect(a.formatted).not.toBe(b.formatted);
  });

  it("rejects a mistyped character", () => {
    const token = generateRecoveryToken();
    const corrupted = token.formatted.slice(0, -1) + "0";
    if (corrupted === token.formatted) return; // (extremely unlikely collision)
    expect(() => parseRecoveryToken(corrupted)).toThrow(
      InvalidRecoveryTokenError,
    );
  });

  it("rejects a transposed pair of characters via the check symbol", () => {
    const token = generateRecoveryToken();
    const groups = token.formatted.split("-");
    const payload = groups.slice(1, -1).join("");
    const [a, b, ...rest] = payload.split("");
    const transposed = [b, a, ...rest].join("");
    if (transposed === payload) return;
    const tampered = `STK1-${transposed}-${groups[groups.length - 1]}`;
    expect(() => parseRecoveryToken(tampered)).toThrow(
      InvalidRecoveryTokenError,
    );
  });

  it("rejects garbage input", () => {
    expect(() => parseRecoveryToken("not-a-token")).toThrow(
      InvalidRecoveryTokenError,
    );
    expect(() => parseRecoveryToken("")).toThrow(InvalidRecoveryTokenError);
  });
});
