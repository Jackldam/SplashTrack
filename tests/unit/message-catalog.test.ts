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
 * a next-intl error in a real browser, on whichever locale was forgotten — and
 * which one that is will be arbitrary, while Dutch is what an instructor
 * actually reads at the poolside (D-159 governs identifiers, not the UI).
 *
 * `06-delivery.md` §2.1 lists an i18n missing-key check as a required addition
 * that nothing gates today. This is the parity half of it. The other half —
 * "every key a component asks for actually exists" — needs components.
 *
 * Both catalogues start at exact parity, so this begins from a clean baseline
 * rather than grandfathering drift.
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

  // The template additionally pinned the specific message keys its
  // anti-lockout paths reach for, so a one-sided rename could not leave an
  // operator staring at a next-intl error instead of an explanation. That test
  // is NOT carried across: it named keys for admin screens that do not exist
  // here, so it would have asserted the presence of copy for features nobody
  // has built. The PATTERN is worth repeating per surface — pin the keys a
  // failure path depends on, because those are the ones no happy-path click-
  // through ever exercises — and it belongs with the first such surface.
});
