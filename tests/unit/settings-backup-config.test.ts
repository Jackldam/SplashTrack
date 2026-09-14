import { describe, expect, it } from "vitest";

import {
  coerceOrganizationConfig,
  defaultOrganizationConfig,
  ORGANIZATION_CONFIG_VERSION,
  validateOrganizationConfigInput,
} from "@/lib/settings";

describe("OrganizationConfig backup section (§7, D-044)", () => {
  it("defaults premigrationEnabled to true", () => {
    expect(defaultOrganizationConfig().backup).toEqual({
      premigrationEnabled: true,
    });
  });

  it("v3 is the current version", () => {
    expect(ORGANIZATION_CONFIG_VERSION).toBe(3);
  });

  it("coerces a v2 document (no backup section at all) to the safe default", () => {
    const v2Document = { ...defaultOrganizationConfig() } as Record<
      string,
      unknown
    >;
    delete v2Document.backup;
    const coerced = coerceOrganizationConfig(v2Document);
    expect(coerced.backup).toEqual({ premigrationEnabled: true });
  });

  it("coerces a malformed value back to the default (true), never to false", () => {
    const malformed = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: "not a boolean" },
    };
    expect(coerceOrganizationConfig(malformed).backup).toEqual({
      premigrationEnabled: true,
    });
  });

  it("coerces an explicit false through unchanged", () => {
    const explicit = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: false },
    };
    expect(coerceOrganizationConfig(explicit).backup).toEqual({
      premigrationEnabled: false,
    });
  });

  it("strict validation accepts an explicit false and rejects a non-boolean", () => {
    const current = defaultOrganizationConfig();

    const validated = validateOrganizationConfigInput(
      { backup: { premigrationEnabled: false } },
      current,
    );
    expect(validated.backup).toEqual({ premigrationEnabled: false });

    expect(() =>
      validateOrganizationConfigInput(
        { backup: { premigrationEnabled: "nope" } },
        current,
      ),
    ).toThrow();
  });

  it("strict validation preserves the current value when the field is omitted", () => {
    const current = {
      ...defaultOrganizationConfig(),
      backup: { premigrationEnabled: false },
    };
    const validated = validateOrganizationConfigInput({}, current);
    expect(validated.backup).toEqual({ premigrationEnabled: false });
  });
});
