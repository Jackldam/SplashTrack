import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DATA_CLASS_BY_MODEL } from "@/lib/retention/data-class-registry";

/**
 * `DATA_CLASS_BY_MODEL` stays in sync with `prisma/schema.prisma`'s
 * `/// @dataClass <CLASS>` markers, checked BIDIRECTIONALLY — the shape D-135
 * already adopted for `person-reference-sync.test.ts` and D-167 for
 * `encrypted-column-registry.test.ts`.
 *
 * Unlike `@encrypted`, `@dataClass` marks a whole MODEL rather than a field, so
 * this test parses the doc comment immediately above `model <Name> {` rather
 * than reusing `extractModelBlocks` (which returns the model BODY, after the
 * opening brace).
 */

const MARKER = /\/\/\/\s*@dataClass\s+(\S+)\s*\nmodel\s+(\w+)\s*\{/g;

function schemaMarkers(): Map<string, string> {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf-8",
  );
  const found = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(schema)) !== null) {
    found.set(match[2], match[1]);
  }
  return found;
}

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

describe("DATA_CLASS_BY_MODEL stays in sync with prisma/schema.prisma", () => {
  const markers = schemaMarkers();
  const enumMembers = new Set(dataClassEnumMembers());

  it("found at least one marker (sanity check the parser, not the schema)", () => {
    expect(markers.size).toBeGreaterThan(10);
  });

  it("has an entry for every `/// @dataClass` marker in the schema", () => {
    const missing = [...markers.keys()].filter(
      (model) => !(model in DATA_CLASS_BY_MODEL),
    );
    expect(
      missing,
      `${missing.join(", ")} carries a \`/// @dataClass\` marker in ` +
        "prisma/schema.prisma with no entry in DATA_CLASS_BY_MODEL " +
        "(src/lib/retention/data-class-registry.ts).",
    ).toEqual([]);
  });

  it("lists no entry for a model with no `/// @dataClass` marker", () => {
    const stale = Object.keys(DATA_CLASS_BY_MODEL).filter(
      (model) => !markers.has(model),
    );
    expect(
      stale,
      `${stale.join(", ")} is/are listed in DATA_CLASS_BY_MODEL but carry no ` +
        "`/// @dataClass` marker in prisma/schema.prisma - remove the stale " +
        "entry or add the marker back.",
    ).toEqual([]);
  });

  it("agrees with the schema marker's class for every bound model", () => {
    const mismatched = [...markers.entries()]
      .filter(([model]) => model in DATA_CLASS_BY_MODEL)
      .filter(([model, dataClass]) => DATA_CLASS_BY_MODEL[model] !== dataClass)
      .map(
        ([model, dataClass]) =>
          `${model}: schema says ${dataClass}, registry says ${DATA_CLASS_BY_MODEL[model]}`,
      );
    expect(mismatched).toEqual([]);
  });

  it("every marker and every registry value names a real DataClass enum member", () => {
    expect(enumMembers.size).toBeGreaterThan(10);

    const unknownInSchema = [...markers.values()].filter(
      (dataClass) => !enumMembers.has(dataClass),
    );
    expect(
      unknownInSchema,
      `${unknownInSchema.join(", ")} is/are named in a \`/// @dataClass\` ` +
        "marker but is/are not a member of enum DataClass - a typo in the " +
        "schema comment would otherwise pass silently.",
    ).toEqual([]);

    const unknownInRegistry = Object.values(DATA_CLASS_BY_MODEL).filter(
      (dataClass) => !enumMembers.has(dataClass),
    );
    expect(unknownInRegistry).toEqual([]);
  });

  it("binds every model this schema declares — no personal-data table starts unclassified", () => {
    // Every `model X {` in the schema, independent of the marker regex above,
    // so a model whose doc comment forgot the marker entirely is still caught
    // (the marker-based checks above only see markers that exist).
    const schema = readFileSync(
      join(process.cwd(), "prisma", "schema.prisma"),
      "utf-8",
    );
    const allModels = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
      (m) => m[1],
    );
    expect(allModels.length).toBeGreaterThan(10);

    const unbound = allModels.filter(
      (model) => !(model in DATA_CLASS_BY_MODEL),
    );
    expect(
      unbound,
      `${unbound.join(", ")} has/have no \`/// @dataClass\` marker at all - ` +
        "CLAUDE.md rule 5 requires a retention policy from the day a table is " +
        "created, not after the fact.",
    ).toEqual([]);
  });
});
