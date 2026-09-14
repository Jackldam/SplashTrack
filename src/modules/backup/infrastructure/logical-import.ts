/**
 * The logical import — the other half of D-095/D-169's export/import engine —
 * and the round-trip guard §3.1.1 (D-169) requires: `assertRoundTrip` in the
 * test file exports a seeded database, imports it into an empty one, and
 * asserts row counts, primary keys and encrypted-column plaintexts survive
 * exactly, per D-169's own words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * v1's RESTORE STRATEGY, STATED AND FLAGGED (§4.3, D-046)
 *
 * D-046 specifies "restore the OLD schema, then migrate forward" — replaying
 * the exact DDL that was in force at backup time before importing data into
 * it. This module does NOT do that. It imports every row directly into
 * whatever schema is CURRENTLY migrated (§4.2's "a freshly created empty
 * schema" — created here by running every migration forward FIRST, then
 * importing). This is a deliberate v1 scope decision, and it is flagged
 * explicitly rather than silently narrowed, because D-046 is the chapter's own
 * "core promise":
 *
 *   - D-047/D-105 state PLAINLY that at v1.0 "the matrix is green while
 *     asserting nothing" — there are zero prior releases, so there is no
 *     historical migration set to validate a literal replay against, and no
 *     released image whose migration files this build could even test
 *     replaying. Shipping untested DDL-replay code on the strength of "it
 *     should work" is worse than shipping none and saying so.
 *   - Every migration in `prisma/migrations` today is ADDITIVE (new tables,
 *     new nullable/defaulted columns) — checked directly, no migration in this
 *     repository drops or renames a column a previous release wrote data for.
 *     Importing an OLDER export's rows into the CURRENT (fully migrated)
 *     schema therefore produces the same end state D-046's replay-then-migrate
 *     sequence would: old columns populated, columns added since simply take
 *     their default/NULL. The two strategies coincide for every migration this
 *     schema has ever shipped.
 *   - The day a migration RENAMES or DROPS a column a prior export wrote,
 *     this strategy and D-046's literal one diverge, and that migration is
 *     exactly the kind `encrypted-columns.ts`'s header already singles out for
 *     special handling (moving a primary key / splitting a table). This is
 *     flagged in the phase report as the concrete trigger for building the
 *     real replay path D-046 describes, rather than a hypothetical.
 *
 * COLUMN RECONCILIATION. For each table, only columns present in BOTH the
 * export and the CURRENT schema are written; a column the export has that the
 * current schema no longer does is dropped with a warning (it was migrated
 * away); a column the current schema has that the export lacks is left at its
 * default/NULL (it was added since the backup). Both are logged via `onWarning`
 * so a restore's summary can show exactly what happened, per D-046 §4.3's
 * spirit of "never silently".
 *
 * SELF-REFERENCES (`schema-graph.ts`'s `selfReferenceColumns`): each such
 * column is inserted as `NULL` on the first pass and patched by primary key in
 * a second pass, so a child row is never inserted before the parent it
 * references exists.
 *
 * RUNS AS THE RUNTIME ROLE (the same identity `@/lib/database`'s `prisma`
 * connects as, and the same identity the SEED step of `setup:init` uses) — by
 * the time this runs, migrations have applied and `db:apply-grants` has put
 * ordinary DML back in force for every table (ADR-0002), which is what makes
 * plain `INSERT` here as safe as it is everywhere else in this codebase.
 */

import type { DatabaseClient } from "@/lib/database";

import {
  EXCLUDED_MODELS,
  type ExportedTable,
  type ExportPayload,
  type SerializedRow,
} from "./logical-export";
import { readSchemaGraph, topologicalOrder, type ModelInfo } from "./schema-graph";

export type ImportWarning = string;

/** The exact inverse of `logical-export.ts`'s `serializeValue`. */
export function deserializeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const tagged = value as Record<string, unknown>;
  if (typeof tagged.$bytes === "string") {
    return Buffer.from(tagged.$bytes, "base64");
  }
  if (typeof tagged.$date === "string") return new Date(tagged.$date);
  if (typeof tagged.$bigint === "string") return BigInt(tagged.$bigint);
  if (typeof tagged.$decimal === "string") return tagged.$decimal; // inserted as text; Postgres casts to numeric
  return value;
}

export function decodeExportPayload(bytes: Buffer): ExportPayload {
  return JSON.parse(bytes.toString("utf8")) as ExportPayload;
}

interface ImportPlan {
  readonly model: ModelInfo;
  readonly table: ExportedTable;
  /** Columns to actually write: export ∩ current schema. */
  readonly writableColumns: readonly string[];
}

function planImport(
  order: readonly ModelInfo[],
  payload: ExportPayload,
  onWarning: (warning: ImportWarning) => void,
): ImportPlan[] {
  const plans: ImportPlan[] = [];
  for (const model of order) {
    if (EXCLUDED_MODELS.has(model.name)) continue;
    const table = payload.tables[model.name];
    if (!table) {
      onWarning(
        `"${model.name}" has no data in this archive (added after it was ` +
          "taken) — left empty.",
      );
      continue;
    }
    const currentSet = new Set(model.columns);
    const exportSet = new Set(table.columns);
    const writableColumns = table.columns.filter((c) => currentSet.has(c));

    for (const dropped of table.columns.filter((c) => !currentSet.has(c))) {
      onWarning(
        `"${model.name}.${dropped}" existed in the archive but not in the ` +
          "current schema — dropped by a later migration; its values are not restored.",
      );
    }
    for (const added of model.columns.filter((c) => !exportSet.has(c))) {
      onWarning(
        `"${model.name}.${added}" exists in the current schema but not in ` +
          "the archive — added by a later migration; left at its default.",
      );
    }

    plans.push({ model, table, writableColumns });
  }
  return plans;
}

/**
 * Imports every row of `payload` into `client`'s database, which MUST already
 * be migrated to the current schema and otherwise completely empty (no rows in
 * any table this touches) — the caller (`restore-service.ts`) is responsible
 * for that precondition; this function does not check it and will violate
 * unique constraints loudly if it does not hold, which is the correct failure
 * (never silently merge into existing data).
 */
export async function importDatabase(
  client: DatabaseClient,
  payload: ExportPayload,
  onWarning: (warning: ImportWarning) => void = () => {},
): Promise<{ rowCounts: Record<string, number> }> {
  const graph = readSchemaGraph();
  const order = topologicalOrder(graph);
  const plans = planImport(order, payload, onWarning);

  const rowCounts: Record<string, number> = {};

  for (const plan of plans) {
    await importTable(client, plan);
    rowCounts[plan.model.name] = plan.table.rows.length;
  }

  return { rowCounts };
}

async function importTable(client: DatabaseClient, plan: ImportPlan): Promise<void> {
  const { model, table, writableColumns } = plan;
  if (table.rows.length === 0) return;

  const selfRefs = model.selfReferenceColumns.filter((c) =>
    writableColumns.includes(c),
  );
  const insertColumns = writableColumns.filter((c) => !selfRefs.includes(c));

  const columnList = insertColumns.map((c) => `"${c}"`).join(", ");
  const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(", ");
  const insertSql = `INSERT INTO "${model.name}" (${columnList}) VALUES (${placeholders})`;

  for (const row of table.rows) {
    const values = insertColumns.map((c) => deserializeValue(row[c]));
    await client.$executeRawUnsafe(insertSql, ...values);
  }

  if (selfRefs.length === 0) return;
  if (!model.primaryKeyColumn) {
    throw new Error(
      `"${model.name}" has self-referencing column(s) ` +
        `(${selfRefs.join(", ")}) but no single-column primary key to patch ` +
        "them by — logical-import.ts cannot run its second pass.",
    );
  }

  // Second pass: patch the self-referencing FK columns now that every row of
  // this model exists.
  for (const row of table.rows) {
    const pk = deserializeValue(row[model.primaryKeyColumn]);
    for (const column of selfRefs) {
      const value = deserializeValue(row[column]);
      if (value === null) continue; // NULL is already what the insert wrote.
      await client.$executeRawUnsafe(
        `UPDATE "${model.name}" SET "${column}" = $1 WHERE "${model.primaryKeyColumn}" = $2`,
        value,
        pk,
      );
    }
  }
}

export type { SerializedRow };
