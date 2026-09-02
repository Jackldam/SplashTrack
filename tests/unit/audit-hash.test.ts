import { describe, expect, it } from "vitest";

import {
  AUDIT_GENESIS_HASH,
  canonicalizeAuditContent,
  computeAuditHash,
  CURRENT_AUDIT_CONTENT_VERSION,
  type AuditHashContent,
} from "@/modules/audit/domain/audit-event";

/** Unit tests for the audit hash-chain primitives (Section 16 tamper-evidence). */

const base: AuditHashContent = {
  contentVersion: 1,
  eventType: "test.event",
  occurredAt: new Date("2026-07-18T09:00:00.000Z"),
  outcome: "SUCCESS",
  actorPersonId: "person_1",
  actorCredentialId: null,
  actorAuthMethod: "session",
  organizationId: "org_1",
  targetType: "person",
  targetId: "person_2",
  requestId: "req_1",
  changedFields: { fieldKey: "allergies", consentStatus: "not_given" },
  reason: null,
};

describe("computeAuditHash", () => {
  it("is deterministic for identical content + previousHash", () => {
    expect(computeAuditHash(AUDIT_GENESIS_HASH, base)).toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, base),
    );
  });

  it("changes when ANY committed field changes", () => {
    const original = computeAuditHash(AUDIT_GENESIS_HASH, base);
    expect(
      computeAuditHash(AUDIT_GENESIS_HASH, { ...base, outcome: "DENIED" }),
    ).not.toBe(original);
    expect(
      computeAuditHash(AUDIT_GENESIS_HASH, { ...base, targetId: "person_9" }),
    ).not.toBe(original);
    expect(
      computeAuditHash(AUDIT_GENESIS_HASH, {
        ...base,
        changedFields: { fieldKey: "iban", consentStatus: "not_given" },
      }),
    ).not.toBe(original);
  });

  it("changes when the previousHash (chain link) changes", () => {
    expect(computeAuditHash("some-other-hash", base)).not.toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, base),
    );
  });

  it("is INSENSITIVE to changedFields key ORDER (canonicalized)", () => {
    const reordered: AuditHashContent = {
      ...base,
      changedFields: { consentStatus: "not_given", fieldKey: "allergies" },
    };
    expect(computeAuditHash(AUDIT_GENESIS_HASH, reordered)).toBe(
      computeAuditHash(AUDIT_GENESIS_HASH, base),
    );
  });
});

describe("canonicalizeAuditContent", () => {
  it("emits a stable string with sorted changedFields keys", () => {
    const a = canonicalizeAuditContent(base);
    const b = canonicalizeAuditContent({
      ...base,
      changedFields: { consentStatus: "not_given", fieldKey: "allergies" },
    });
    expect(a).toBe(b);
    // fieldKey sorts before consentStatus.
    expect(a).toContain('{"consentStatus":"not_given","fieldKey":"allergies"}');
  });
});

/**
 * Versioned canonicalization (ADR-018 Correction C / ADR-020). The delicate
 * property: adding `actorCredentialId` to the hashed content must NOT change a v1
 * row's digest, so historical rows keep verifying, while v2 rows commit to the
 * new field. `canonicalizeAuditContent` branches on `contentVersion`.
 */
describe("versioned canonicalization (v1 ↔ v2)", () => {
  it("v1 canonicalization is FROZEN — the original 11-field array, ignoring actorCredentialId", () => {
    // A v1 row's canonical form is exactly the historical array and must not
    // depend on the new field, whatever value it carries.
    const v1 = canonicalizeAuditContent({ ...base, contentVersion: 1 });
    const v1WithStrayCredential = canonicalizeAuditContent({
      ...base,
      contentVersion: 1,
      actorCredentialId: "cred_should_be_ignored",
    });
    expect(v1).toBe(v1WithStrayCredential);

    // This is the byte-for-byte array every historical row committed to — a
    // regression here would silently invalidate the whole trail's history.
    expect(v1).toBe(
      JSON.stringify([
        "test.event",
        "2026-07-18T09:00:00.000Z",
        "SUCCESS",
        "person_1",
        "session",
        "org_1",
        "person",
        "person_2",
        "req_1",
        { consentStatus: "not_given", fieldKey: "allergies" },
        null,
      ]),
    );
  });

  it("a legacy row defaulting to version 1 digests identically to an explicit v1", () => {
    // The column defaults to 1; a value <= 1 must take the v1 branch.
    expect(canonicalizeAuditContent({ ...base, contentVersion: 1 })).toBe(
      canonicalizeAuditContent({ ...base, contentVersion: 0 }),
    );
  });

  it("v2 APPENDS actorCredentialId, so the v1 prefix is byte-for-byte identical", () => {
    const v1 = canonicalizeAuditContent({ ...base, contentVersion: 1 });
    const v2 = canonicalizeAuditContent({
      ...base,
      contentVersion: 2,
      actorCredentialId: "cred_1",
    });
    // v2 = v1 array with one element appended → the v1 serialization is a strict
    // prefix once the closing bracket is dropped.
    expect(v2).not.toBe(v1);
    expect(v2).toBe(`${v1.slice(0, -1)},"cred_1"]`);
  });

  it("a v2 row's hash DOES depend on actorCredentialId (it is committed)", () => {
    const withCred = computeAuditHash(AUDIT_GENESIS_HASH, {
      ...base,
      contentVersion: 2,
      actorCredentialId: "cred_1",
    });
    const withoutCred = computeAuditHash(AUDIT_GENESIS_HASH, {
      ...base,
      contentVersion: 2,
      actorCredentialId: null,
    });
    expect(withCred).not.toBe(withoutCred);
  });

  it("new rows are written at the current version, which carries the credential actor", () => {
    expect(CURRENT_AUDIT_CONTENT_VERSION).toBeGreaterThanOrEqual(2);
  });
});
