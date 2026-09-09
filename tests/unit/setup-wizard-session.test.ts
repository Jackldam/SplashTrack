/**
 * The wizard's cookie: signed, expiring, and unforgeable without the instance's
 * own key (D-112's `setup-session-v1` branch).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS ACTUALLY UNDER TEST
 *
 * The cookie asserts ONE fact: this browser presented the one-time setup token
 * before it expired. It is not the gate — the boot state is
 * (`setup-wizard-gate.test.ts`) — but it is what stands between "typed the
 * token" and "may create the administrator of this installation", so a forged
 * one must not pass.
 *
 * THE FORGERY CASE IS THE POINT, and it is written to be non-vacuous: the same
 * payload is presented twice, once with a signature this instance made and once
 * with one it did not. If the MAC were decorative the two would agree.
 */

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { deriveKey } from "@/lib/crypto";
import {
  WIZARD_SESSION_TTL_MINUTES,
  mintWizardSession,
  verifyWizardSession,
} from "@/lib/setup/wizard-session";

/** A payload with an arbitrary expiry, as an attacker would construct one. */
function payloadWithExpiry(expiresAt: number): string {
  return Buffer.from(JSON.stringify({ exp: expiresAt }), "utf8").toString(
    "base64url",
  );
}

/** The real signature — what this instance would produce for that payload. */
function realSignature(payload: string): string {
  return createHmac("sha256", deriveKey("setup-session-v1"))
    .update(payload)
    .digest("base64url");
}

describe("mint and verify", () => {
  it("accepts a value it just minted", () => {
    expect(verifyWizardSession(mintWizardSession())).toBe(true);
  });

  it("expires after the stated window and not before", () => {
    const now = new Date("2026-09-05T10:00:00.000Z");
    const value = mintWizardSession(now);

    const justInside = new Date(
      now.getTime() + WIZARD_SESSION_TTL_MINUTES * 60_000 - 1_000,
    );
    const justOutside = new Date(
      now.getTime() + WIZARD_SESSION_TTL_MINUTES * 60_000 + 1_000,
    );

    expect(verifyWizardSession(value, justInside)).toBe(true);
    expect(verifyWizardSession(value, justOutside)).toBe(false);
  });

  it("refuses an absent or empty cookie", () => {
    expect(verifyWizardSession(undefined)).toBe(false);
    expect(verifyWizardSession("")).toBe(false);
    expect(verifyWizardSession("nonsense")).toBe(false);
  });
});

describe("forgery", () => {
  it("refuses a payload signed with anything but this instance's key", () => {
    // A far-future expiry — what an attacker actually wants — with a signature
    // made under a different key.
    const payload = payloadWithExpiry(Date.now() + 365 * 24 * 3_600_000);
    const forged = createHmac("sha256", Buffer.alloc(32, 7))
      .update(payload)
      .digest("base64url");

    expect(verifyWizardSession(`${payload}.${forged}`)).toBe(false);

    // NON-VACUOUS: THE SAME PAYLOAD, correctly signed, IS accepted. So the
    // refusal above is the signature failing and not the payload being
    // rejected for some other reason.
    expect(verifyWizardSession(`${payload}.${realSignature(payload)}`)).toBe(
      true,
    );
  });

  it("refuses a payload edited after it was signed", () => {
    // The classic: take a real cookie, extend its expiry, keep the signature.
    const now = new Date("2026-09-05T10:00:00.000Z");
    const real = mintWizardSession(now);
    const signature = real.slice(real.lastIndexOf(".") + 1);

    const extended = payloadWithExpiry(
      now.getTime() + 10 * 365 * 24 * 3_600_000,
    );
    expect(verifyWizardSession(`${extended}.${signature}`, now)).toBe(false);
  });

  it("refuses a truncated or re-encoded signature", () => {
    const value = mintWizardSession();
    const separator = value.lastIndexOf(".");
    const payload = value.slice(0, separator);
    const signature = value.slice(separator + 1);

    expect(verifyWizardSession(`${payload}.${signature.slice(0, -1)}`)).toBe(
      false,
    );
    expect(verifyWizardSession(`${payload}.`)).toBe(false);
    expect(verifyWizardSession(payload)).toBe(false);
  });

  it("refuses a signature that is valid for a DIFFERENT payload", () => {
    // Signature reuse across payloads — what an implementation that MACs a
    // constant, or MACs the wrong thing, would let through.
    const other = payloadWithExpiry(Date.now() + 3_600_000);
    const mine = payloadWithExpiry(Date.now() + 7_200_000);
    expect(verifyWizardSession(`${mine}.${realSignature(other)}`)).toBe(false);
  });

  it("does not parse the payload before the signature holds", () => {
    // A payload that would throw in `JSON.parse` must be refused by the MAC,
    // not by the parser: feeding unauthenticated bytes to a parser and then
    // trusting a number out of it is what turns a MAC into decoration. The
    // assertion available from outside is that it refuses rather than throws.
    expect(() =>
      verifyWizardSession(`${Buffer.from("{oops").toString("base64url")}.x`),
    ).not.toThrow();
    expect(
      verifyWizardSession(`${Buffer.from("{oops").toString("base64url")}.x`),
    ).toBe(false);
  });
});
