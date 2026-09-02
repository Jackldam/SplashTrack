import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The message catalogs (`messages/en.json`, `messages/nl.json`) must stay in
 * lockstep, and the keys a Server Action names must actually exist in them.
 *
 * WHY: nothing else in the pipeline checks this. A key that exists in `en` but
 * not `nl` — or a typo in the string an action passes to `t()` — typechecks
 * cleanly, builds cleanly, and passes every service-level test, because the
 * action tests mock `getTranslations` to echo the key back. It surfaces only as
 * a next-intl error in a real browser, on whichever locale was forgotten. Both
 * catalogs were at exact parity (1935 keys) when this was written, so this
 * starts from a clean baseline rather than grandfathering drift.
 */

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      for (const [k, v] of flatten(child, prefix ? `${prefix}.${key}` : key)) {
        out.set(k, v);
      }
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

function load(locale: string): Map<string, unknown> {
  const path = join(process.cwd(), "messages", `${locale}.json`);
  return flatten(JSON.parse(readFileSync(path, "utf8")));
}

const en = load("en");
const nl = load("nl");

describe("message catalogs", () => {
  it("define exactly the same keys in every locale", () => {
    const onlyEn = [...en.keys()].filter((k) => !nl.has(k)).sort();
    const onlyNl = [...nl.keys()].filter((k) => !en.has(k)).sort();
    expect({ onlyEn, onlyNl }).toEqual({ onlyEn: [], onlyNl: [] });
  });

  it("has no empty or non-string values", () => {
    for (const [locale, catalog] of [
      ["en", en],
      ["nl", nl],
    ] as const) {
      const bad = [...catalog.entries()]
        .filter(([, v]) => typeof v !== "string" || v.trim() === "")
        .map(([k]) => `${locale}:${k}`);
      expect(bad).toEqual([]);
    }
  });

  it("carries the anti-lockout messages both disable paths depend on", () => {
    // These are the keys `setPlatformUserDisabledAction` and
    // `setMemberDisabledAction` reach for when `checkPlatformAdminFloor`
    // refuses. A rename on one side only would leave an operator staring at a
    // next-intl error instead of being told why the account cannot be disabled.
    for (const key of [
      "admin.users.edit.errors.lastActiveAdmin",
      "org.users.status.errors.lastActiveAdmin",
      "org.users.erase.lastAdmin",
    ]) {
      expect(en.get(key), `${key} missing from en`).toBeTypeOf("string");
      expect(nl.get(key), `${key} missing from nl`).toBeTypeOf("string");
    }
  });
});
