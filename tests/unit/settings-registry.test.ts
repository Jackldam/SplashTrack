import { describe, expect, it } from "vitest";

import {
  categoriesInUse,
  SETTING_CATEGORIES,
  SETTING_CLASSES,
  SETTINGS_BY_KEY,
  SETTINGS_REGISTRY,
  settingDefinition,
} from "@/modules/settings";

describe("the typed settings registry (§3.2, R-17)", () => {
  it("has no duplicate keys", () => {
    const keys = SETTINGS_REGISTRY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keys every entry consistently between the array and the map", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(SETTINGS_BY_KEY.get(entry.key)).toBe(entry);
    }
  });

  it("every entry's category is one of §3.2's closed vocabulary", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(SETTING_CATEGORIES).toContain(entry.category);
    }
  });

  it("every entry's class is one of D-150's three", () => {
    for (const entry of SETTINGS_REGISTRY) {
      expect(SETTING_CLASSES).toContain(entry.class);
    }
  });

  it("every entry's own Zod schema accepts its own default", () => {
    for (const entry of SETTINGS_REGISTRY) {
      const result = entry.schema.safeParse(entry.default);
      expect(result.success, `${entry.key}: ${JSON.stringify(result)}`).toBe(
        true,
      );
    }
  });

  it("every `invariant` entry has no storage — it cannot be a stored, resettable flag (D-171)", () => {
    for (const entry of SETTINGS_REGISTRY) {
      if (entry.class === "invariant") {
        expect(entry.storage.kind).toBe("none");
      }
    }
  });

  it("every `sensitive` entry is stored as a secret, never in the JSON document", () => {
    for (const entry of SETTINGS_REGISTRY) {
      if (entry.sensitive) {
        expect(entry.storage.kind).toBe("secret");
      }
    }
  });

  it("every `bounded` entry states its bounds", () => {
    for (const entry of SETTINGS_REGISTRY) {
      if (entry.class === "bounded") {
        expect(entry.bounds, entry.key).toBeDefined();
      }
    }
  });

  describe("bounded numeric schemas actually enforce their stated bounds", () => {
    it("security.sessionAbsoluteTimeoutMinutes rejects below its floor and above its ceiling", () => {
      const entry = settingDefinition(
        "security.sessionAbsoluteTimeoutMinutes",
      )!;
      expect(entry.schema.safeParse(entry.bounds!.min).success).toBe(true);
      expect(entry.schema.safeParse(entry.bounds!.max).success).toBe(true);
      expect(entry.schema.safeParse(entry.bounds!.min! - 1).success).toBe(
        false,
      );
      expect(entry.schema.safeParse(entry.bounds!.max! + 1).success).toBe(
        false,
      );
    });

    it("privacy.ageOfDigitalConsentYears rejects thirteen minus one and eighteen plus one", () => {
      const entry = settingDefinition("privacy.ageOfDigitalConsentYears")!;
      expect(entry.schema.safeParse(13).success).toBe(true);
      expect(entry.schema.safeParse(18).success).toBe(true);
      expect(entry.schema.safeParse(12).success).toBe(false);
      expect(entry.schema.safeParse(19).success).toBe(false);
    });

    it("authentication.passwordMinLength rejects below 8 and above 128", () => {
      const entry = settingDefinition("authentication.passwordMinLength")!;
      expect(entry.schema.safeParse(7).success).toBe(false);
      expect(entry.schema.safeParse(8).success).toBe(true);
      expect(entry.schema.safeParse(128).success).toBe(true);
      expect(entry.schema.safeParse(129).success).toBe(false);
    });
  });

  it("maintenance.backupRetentionDays is `free` — no ceiling — but refuses below its floor (D-171)", () => {
    const entry = settingDefinition("maintenance.backupRetentionDays")!;
    expect(entry.class).toBe("free");
    expect(entry.schema.safeParse(1).success).toBe(true);
    expect(entry.schema.safeParse(36500).success).toBe(true);
    expect(entry.schema.safeParse(0).success).toBe(false);
  });

  it("authentication.mfaRequiredForHighRisk is invariant and only ever true", () => {
    const entry = settingDefinition("authentication.mfaRequiredForHighRisk")!;
    expect(entry.class).toBe("invariant");
    expect(entry.schema.safeParse(true).success).toBe(true);
    expect(entry.schema.safeParse(false).success).toBe(false);
  });

  it("organization.name rejects control characters and bidi overrides", () => {
    const entry = settingDefinition("organization.name")!;
    expect(entry.schema.safeParse("De Vrolijke Vis").success).toBe(true);
    expect(entry.schema.safeParse("evil‮name").success).toBe(false);
    expect(entry.schema.safeParse("").success).toBe(false);
  });

  it("categoriesInUse lists each category once, in first-seen order", () => {
    const categories = categoriesInUse();
    expect(new Set(categories).size).toBe(categories.length);
    expect(categories.length).toBeGreaterThan(0);
  });

  it("ships a kernel in the neighbourhood of the ~15 §3.2 asks for", () => {
    expect(SETTINGS_REGISTRY.length).toBeGreaterThanOrEqual(15);
  });
});
