/**
 * A minimal `prisma/schema.prisma` reader for the logical export/import engine
 * (D-095/D-169, `docs/design/14-backup-restore-upgrade.md` §3.1.1).
 *
 * WHY THIS PARSES THE SCHEMA FILE INSTEAD OF USING PRISMA'S DMMF. The
 * generator this project pins (`prisma@7`) does not export a runtime DMMF from
 * the generated client (`Prisma.dmmf` is absent — checked directly against
 * this project's `src/generated/prisma/client`), so there is no supported
 * in-process way to ask "what are this model's columns and foreign keys".
 * `prisma/schema.prisma` has neither `@map` nor `@@map` anywhere in this
 * project (checked directly), so a Prisma model name IS its Postgres table
 * name and a field name IS its column name — which is what makes a
 * lightweight structural parse of the schema TEXT a reliable, dependency-free
 * source of the same information, rather than a fragile approximation of it.
 *
 * WHAT A "COLUMN" IS, STRUCTURALLY. A field is a real database column iff its
 * base type (stripped of `?`/`[]`) is NOT the name of another model — that
 * excludes both to-one relation fields (`person Person @relation(...)`, whose
 * column is the separate scalar `personId` field) and to-many relation array
 * fields (`periods MembershipPeriod[]`, which has no column at all). Enum and
 * scalar (`String`, `Int`, `DateTime`, …) fields are always columns.
 *
 * DEPENDENCY ORDER. A model DEPENDS ON every OTHER model named by one of its
 * `@relation(fields: …)` scalar-object fields (i.e. it holds the foreign key).
 * `topologicalOrder()` returns models parent-first, which is the order
 * `logical-import.ts` must write rows in — and the order `logical-export.ts`
 * uses too, purely so a diff of two exports is stable.
 *
 * SELF-REFERENCES. Four models in this schema reference themselves
 * (`OrganizationUnit.parentId`, and three `…Supersedes` chains) — checked
 * directly, and every one of those FK columns is nullable. `selfReferenceColumns`
 * names them so the importer can insert with them NULLed and patch them in a
 * second pass, rather than failing to order a model against itself.
 *
 * NO CROSS-MODEL CYCLES EXIST in this schema today (verified directly by
 * building the dependency graph and searching for one) — `topologicalOrder`
 * throws if a future migration introduces one, which is a deliberate build
 * failure rather than a silent wrong import order.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const SCALAR_KEYWORDS = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "DateTime",
  "Json",
  "Bytes",
  "Decimal",
  "BigInt",
]);

export interface ModelField {
  readonly name: string;
  readonly type: string;
  readonly isArray: boolean;
  readonly isRelationObject: boolean;
}

export interface ModelInfo {
  readonly name: string;
  /** Column names, in schema declaration order. */
  readonly columns: readonly string[];
  /** Other model names this model holds a foreign key to (excluding itself). */
  readonly dependsOn: readonly string[];
  /** This model's OWN FK columns that reference itself (nullable, per the
   * module doc) — the importer nulls these on first insert and patches them
   * in a second pass. */
  readonly selfReferenceColumns: readonly string[];
  /**
   * The single-column primary key's field name, e.g. `"id"` for almost every
   * model, `"key"` for `RateLimitCounter`, `"dataClass"` for `RetentionPolicy`.
   * `null` for a model with a composite (`@@id([...])`) or no declared primary
   * key — `logical-export.ts` falls back to unordered reads for those (there
   * are none in this schema today; see its own check).
   */
  readonly primaryKeyColumn: string | null;
}

export interface SchemaGraph {
  readonly models: ReadonlyMap<string, ModelInfo>;
}

function parseModelBody(name: string, body: string, modelNames: Set<string>): ModelInfo {
  const columns: string[] = [];
  const dependsOn = new Set<string>();
  const selfReferenceColumns: string[] = [];
  let primaryKeyColumn: string | null = null;

  const fieldPattern =
    /^\s*(\w+)\s+(\w+)(\[\])?(\?)?((?:\s+@[^\n]*)*)\s*$/;

  for (const rawLine of body.split("\n")) {
    // Strip `///` doc comments and `//` line comments before matching.
    const line = rawLine.replace(/\/\/.*$/, "");
    if (!line.trim()) continue;
    if (/^\s*@@/.test(line)) continue; // block attribute (@@id, @@unique, …)

    const match = fieldPattern.exec(line);
    if (!match) continue;
    const [, fieldName, typeName, isArray, , attributes] = match;

    if (modelNames.has(typeName)) {
      // A relation OBJECT field — never a column. Only the OWNING side (the
      // one spelling `@relation(fields: [...], references: [...])`) creates a
      // dependency; the back-reference side (no `fields:`, or an array) names
      // no foreign key of its own and must NOT be treated as one — Prisma
      // relations are declared on both models, and treating the back-reference
      // side as a dependency too turns every one-to-many relation into a
      // (non-existent) cycle.
      const ownsForeignKey = /@relation\([^)]*\bfields\s*:/.test(attributes);
      if (!isArray && ownsForeignKey && typeName !== name) {
        dependsOn.add(typeName);
      }
      continue;
    }
    // A scalar or enum field IS a column, including FK id columns like
    // `personId String` and `unitId String?`.
    columns.push(fieldName);
    if (/\B@id\b/.test(attributes) && !attributes.includes("@@id")) {
      primaryKeyColumn = fieldName;
    }

    // A self-referencing FK is spelled as a relation OBJECT field
    // (`parent OrganizationUnit? @relation(fields: [parentId], ...)`), not as
    // this scalar column — so self-references are detected from the relation
    // fields below, not here. See the second pass.
  }

  // Second pass: find self-referencing relation fields, to know which FK
  // *column* (named in `fields: [...]`) needs two-phase import.
  const selfRelationPattern = new RegExp(
    `^\\s*\\w+\\s+${name}\\??\\s*(?:\\[\\])?\\s*@relation\\([^)]*fields:\\s*\\[([^\\]]+)\\]`,
    "gm",
  );
  let selfMatch: RegExpExecArray | null;
  while ((selfMatch = selfRelationPattern.exec(body))) {
    for (const col of selfMatch[1].split(",").map((c) => c.trim())) {
      if (col) selfReferenceColumns.push(col);
    }
  }

  return {
    name,
    columns,
    primaryKeyColumn,
    dependsOn: [...dependsOn],
    selfReferenceColumns,
  };
}

let cached: SchemaGraph | undefined;

/** Parses `prisma/schema.prisma` (relative to `process.cwd()`, overridable for
 * tests) into a {@link SchemaGraph}. Cached per-process — the schema file does
 * not change while the process runs. */
export function readSchemaGraph(
  schemaPath: string = path.resolve(process.cwd(), "prisma/schema.prisma"),
): SchemaGraph {
  if (cached && schemaPath === path.resolve(process.cwd(), "prisma/schema.prisma")) {
    return cached;
  }
  const text = readFileSync(schemaPath, "utf8");
  const modelBlocks = [...text.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  const modelNames = new Set(modelBlocks.map((m) => m[1]));

  // Enums are neither columns nor models to depend on; SCALAR_KEYWORDS plus
  // enum names are simply "not a model", which parseModelBody already treats
  // correctly since it only special-cases names IN `modelNames`.
  void SCALAR_KEYWORDS;

  const models = new Map<string, ModelInfo>();
  for (const [, name, body] of modelBlocks) {
    models.set(name, parseModelBody(name, body, modelNames));
  }

  const graph: SchemaGraph = { models };
  if (schemaPath === path.resolve(process.cwd(), "prisma/schema.prisma")) {
    cached = graph;
  }
  return graph;
}

/** Test seam: drops the process-level cache. */
export function resetSchemaGraphCache(): void {
  cached = undefined;
}

export class SchemaCycleError extends Error {
  constructor(remaining: readonly string[]) {
    super(
      `The Prisma schema has a foreign-key cycle among [${remaining.join(", ")}] ` +
        "that is not a self-reference. The logical export/import engine " +
        "(D-095/D-169) cannot order these models for import; see " +
        "`schema-graph.ts`'s module doc for the two-phase self-reference " +
        "handling this would need to be extended with.",
    );
    this.name = "SchemaCycleError";
  }
}

/**
 * Parent-first topological order over every model — the order
 * `logical-import.ts` inserts rows in. Self-references (a model depending on
 * itself) do not block ordering; only a cycle across TWO OR MORE DISTINCT
 * models would, and none exists today (see the module doc) — `SchemaCycleError`
 * is the loud failure if one is ever introduced.
 */
export function topologicalOrder(graph: SchemaGraph): ModelInfo[] {
  const remaining = new Map(graph.models);
  const ordered: ModelInfo[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((model) =>
      model.dependsOn.every(
        (dep) => dep === model.name || !remaining.has(dep),
      ),
    );
    if (ready.length === 0) {
      throw new SchemaCycleError([...remaining.keys()]);
    }
    // Stable order: declaration order among the ready set, by insertion into
    // the original map.
    ready.sort(
      (a, b) =>
        [...graph.models.keys()].indexOf(a.name) -
        [...graph.models.keys()].indexOf(b.name),
    );
    for (const model of ready) {
      ordered.push(model);
      remaining.delete(model.name);
    }
  }

  return ordered;
}
