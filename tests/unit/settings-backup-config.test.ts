import { describe, expect, it } from "vitest";

import {
  BACKUP_RETENTION_DAYS,
  coerceOrganizationConfig,
  defaultOrganizationConfig,
  ORGANIZATION_CONFIG_VERSION,
  validateOrganizationConfigInput,
} from "@/lib/settings";

describe("OrganizationConfig backup section (§7, D-044, and §3.2's retentionDays, D-171)", () => {
  it("defaults premigrationEnabled to true and retentionDays to the default", () => {
    expect(defaultOrganizationConfig().backup).toEqual({
      premigrationEnabled: true,
      retentionDays: BACKUP_RETENTION_DAYS.default,
    });
  });

  it("v4 is the current version (phase 3.2 adds authentication/email/security.allowPrivateNetworkEgress/backup.retentionDays)", () => {
    expect(ORGANIZATION_CONFIG_VERSION).toBe(4);
  });

  it("coerces a v2 document (no backup section at all) to the safe default", () => {
    const v2Document = { ...defaultOrganizationConfig() } as Record<
      string,
      unknown
    >;
    delete v2Document.backup;
    const coerced = coerceOrganizationConfig(v2Document);
    expect(coerced.backup).toEqual({
      premigrationEnabled: true,
      retentionDays: BACKUP_RETENTION_DAYS.default,
    });
  });

  it("coerces a malformed value back to the default (true), never to false", () => {
    const malformed = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: "not a boolean" },
    };
    expect(coerceOrganizationConfig(malformed).backup).toEqual({
      premigrationEnabled: true,
      retentionDays: BACKUP_RETENTION_DAYS.default,
    });
  });

  it("coerces an explicit false through unchanged", () => {
    const explicit = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: false },
    };
    expect(coerceOrganizationConfig(explicit).backup).toEqual({
      premigrationEnabled: false,
      retentionDays: BACKUP_RETENTION_DAYS.default,
    });
  });

  it("coerces a malformed retentionDays back to the default", () => {
    const malformed = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: true, retentionDays: "not a number" },
    };
    expect(coerceOrganizationConfig(malformed).backup.retentionDays).toBe(
      BACKUP_RETENTION_DAYS.default,
    );
  });

  it("coerces an explicit retentionDays through unchanged", () => {
    const explicit = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: true, retentionDays: 90 },
    };
    expect(coerceOrganizationConfig(explicit).backup.retentionDays).toBe(90);
  });

  it("strict validation accepts an explicit false and rejects a non-boolean", () => {
    const current = defaultOrganizationConfig();

    const validated = validateOrganizationConfigInput(
      { backup: { premigrationEnabled: false } },
      current,
    );
    expect(validated.backup).toEqual({
      premigrationEnabled: false,
      retentionDays: BACKUP_RETENTION_DAYS.default,
    });

    expect(() =>
      validateOrganizationConfigInput(
        { backup: { premigrationEnabled: "nope" } },
        current,
      ),
    ).toThrow();
  });

  it("strict validation is free (D-171) — no ceiling on retentionDays, but refuses below the floor", () => {
    const current = defaultOrganizationConfig();
    const validated = validateOrganizationConfigInput(
      { backup: { retentionDays: 3650 } },
      current,
    );
    expect(validated.backup.retentionDays).toBe(3650);

    expect(() =>
      validateOrganizationConfigInput(
        { backup: { retentionDays: BACKUP_RETENTION_DAYS.min - 1 } },
        current,
      ),
    ).toThrow();
  });

  it("strict validation preserves the current value when the field is omitted", () => {
    const current = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: false, retentionDays: 45 },
    };
    const validated = validateOrganizationConfigInput({}, current);
    expect(validated.backup).toEqual({
      premigrationEnabled: false,
      retentionDays: 45,
    });
  });
});
