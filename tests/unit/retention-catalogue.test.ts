import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLATFORM_MAXIMUM_RETENTION_DAYS,
  RETENTION_CATALOGUE,
} from "@/lib/retention/catalogue";

/**
 * `RETENTION_CATALOGUE` (D-065, D-110) stays in sync with the `DataClass` enum,
 * and every entry honours the shape D-155 and D-150 require. The parts of this
 * that Postgres itself enforces (`RetentionPolicy_anonymise_requires_aggregate_check`,
 * `RetentionPolicy_retain_for_check`) are re-checked here at the catalogue
 * level, before a single row is ever seeded — the DB constraint catches a bad
 * WRITE; this test catches a bad DEFAULT before it is proposed to anyone.
 */

function dataClassEnumMembers(): string[] {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf-8",
  );
  const start = /enum\s+DataClass\s*\{/.exec(schema);
  if (!start)
    throw new Error("enum DataClass not found in prisma/schema.prisma");
  const bodyStart = start.index + start[0].length;
  const end = schema.indexOf("}", bodyStart);
  return schema
    .slice(bodyStart, end)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("//") && !line.startsWith("///"),
    );
}

describe("RETENTION_CATALOGUE covers exactly the DataClass enum", () => {
  const enumMembers = dataClassEnumMembers();
  const catalogueClasses = RETENTION_CATALOGUE.map((entry) => entry.dataClass);

  it("parsed the enum at all (sanity check the parser, not the schema)", () => {
    expect(enumMembers.length).toBeGreaterThan(10);
  });

  it("has exactly one entry per DataClass member, in both directions", () => {
    expect([...catalogueClasses].sort()).toEqual([...enumMembers].sort());
  });

  it("never declares the same class twice", () => {
    const seen = new Set<string>();
    const duplicates = catalogueClasses.filter((dataClass) =>
      seen.has(dataClass) ? true : (seen.add(dataClass), false),
    );
    expect(duplicates).toEqual([]);
  });
});

describe("every catalogue entry is internally honest", () => {
  it.each(RETENTION_CATALOGUE)(
    "$dataClass: ANONYMISE names an aggregate (D-155) — never a row-level scrub",
    (entry) => {
      if (entry.onExpiry === "ANONYMISE") {
        expect(
          entry.anonymisedAggregate,
          `${entry.dataClass} is ANONYMISE with no named aggregate. D-155: a ` +
            "class that cannot name a pre-computed, non-reidentifiable " +
            "aggregate may only be DELETE or REVIEW.",
        ).toBeTruthy();
      } else {
        expect(
          entry.anonymisedAggregate,
          `${entry.dataClass} is not ANONYMISE and should not carry an ` +
            "aggregate name.",
        ).toBeUndefined();
      }
    },
  );

  it.each(RETENTION_CATALOGUE)(
    "$dataClass: retainForDays is null or a positive integer",
    (entry) => {
      if (entry.retainForDays !== null) {
        expect(Number.isInteger(entry.retainForDays)).toBe(true);
        expect(entry.retainForDays).toBeGreaterThan(0);
      }
    },
  );

  it.each(RETENTION_CATALOGUE)(
    "$dataClass: retainForDays never exceeds the platform maximum (D-150)",
    (entry) => {
      if (entry.retainForDays !== null) {
        expect(entry.retainForDays).toBeLessThanOrEqual(
          PLATFORM_MAXIMUM_RETENTION_DAYS,
        );
      }
    },
  );

  it.each(RETENTION_CATALOGUE)(
    "$dataClass: carries a non-empty purpose and source citation",
    (entry) => {
      expect(entry.purpose.trim().length).toBeGreaterThan(0);
      expect(entry.source.trim().length).toBeGreaterThan(0);
    },
  );

  it("never seeds a confirmed lawful basis (F-27) — the catalogue is a proposal, not a decision", () => {
    // RetentionProposal has no confirmedLawfulBasis field at all: the type
    // itself makes seeding one impossible, not just discouraged. This test
    // exists so that claim stays checked if the type ever grows one.
    for (const entry of RETENTION_CATALOGUE) {
      expect(entry).not.toHaveProperty("confirmedLawfulBasis");
    }
  });
});
