/**
 * The logical export (D-095/D-169, `docs/design/14-backup-restore-upgrade.md`
 * §3.1). A structured export the application writes and reads ITSELF — never a
 * `pg_dump` replay, which D-169 puts out of v1 scope entirely (§4.2.1, F-97):
 * restoring an untrusted dump is arbitrary SQL execution, and this format
 * cannot express that class of attack because it contains no SQL at all, only
 * typed row data validated against the schema the importer already owns.
 *
 * SHAPE: one JSON document, `{ tables: { <Model>: { columns, rows } } }`, in
 * the SAME parent-first order `schema-graph.ts` computes — not load-bearing
 * for export (reads have no ordering constraint) but kept so the payload is
 * deterministic and `logical-import.ts` can iterate the same structure without
 * re-deriving order from a different source of truth.
 *
 * VALUE ENCODING. `$queryRawUnsafe` through `@prisma/adapter-pg` returns
 * Postgres values already coerced to JS types (`Date`, `Buffer`, `bigint`,
 * `Prisma.Decimal`, plain objects for `json`/`jsonb`). None of those survive
 * `JSON.stringify` losslessly, so every non-JSON-native value is TAGGED
 * (`{"$bytes": "<base64>"}`, `{"$date": "<iso>"}`, `{"$bigint": "<string>"}`,
 * `{"$decimal": "<string>"}`) by {@link serializeValue}; `logical-import.ts`'s
 * `deserializeValue` is its exact inverse. A plain `json`/`jsonb` column value
 * is never one of these shapes at the top level in this schema (checked: no
 * column stores a bare `{"$bytes": …}` object), so the tag namespace does not
 * collide with real data.
 *
 * IN-MEMORY (see `../../../lib/crypto/framed-aead.ts`'s module doc for the
 * same trade-off stated once, for the whole archive pipeline): the whole
 * export is built as one JSON document before it is handed to the archive
 * builder. Same reasoning, not restated here.
 */

import type { DatabaseClient } from "@/lib/database";

import {
  readSchemaGraph,
  topologicalOrder,
  type ModelInfo,
} from "./schema-graph";

/**
 * Models deliberately excluded from the export. `RateLimitCounter` is
 * ephemeral rate-limiting state — a sliding-window counter keyed by an IP or
 * account, regenerated continuously and meaningless a day later, let alone
 * across a restore. It carries no personal data on its own and no row of it
 * is anything a restore needs to be "up and running" (§1's own promise); the
 * alternative — restoring stale counters — could even reintroduce a rate-limit
 * window an attacker had already exhausted before the backup was taken. Every
 * OTHER model is exported, including `Session`/`Account`/`Verification`: those
 * are ordinary application state (a restored session is simply short-lived and
 * expiry-checked like any other).
 */
export const EXCLUDED_MODELS: ReadonlySet<string> = new Set([
  "RateLimitCounter",
]);

export type SerializedRow = Record<string, unknown>;

export interface ExportedTable {
  readonly columns: readonly string[];
  readonly rows: readonly SerializedRow[];
}

export interface ExportPayload {
  readonly tables: Readonly<Record<string, ExportedTable>>;
}

/** Tags a value that does not survive `JSON.stringify` losslessly. Exported so
 * `logical-import.ts` can share the exact tag vocabulary rather than guessing
 * it back from shape. */
export function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { $bytes: value.toString("base64") };
  if (value instanceof Uint8Array) {
    return { $bytes: Buffer.from(value).toString("base64") };
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === "bigint") return { $bigint: value.toString() };
  // Prisma.Decimal (and pg's own numeric-as-string) both expose a usable
  // `toString()`; Decimal instances are detected structurally (constructor
  // name) so this module does not import the generated Decimal type just to
  // narrow one branch.
  if (
    typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "Decimal"
  ) {
    return { $decimal: String(value) };
  }
  return value;
}

/** One row of a raw-query result, column name → Postgres-adapter value. */
type RawRow = Record<string, unknown>;

function serializeRow(row: RawRow, columns: readonly string[]): SerializedRow {
  const out: SerializedRow = {};
  for (const column of columns) {
    out[column] = serializeValue(row[column]);
  }
  return out;
}

/**
 * Reads every row of every model, in `schema-graph.ts`'s topological order,
 * via `SELECT * FROM "<Model>" ORDER BY <primary-key-ish>` — `id` in every
 * model in this schema (checked: every model declares `id String @id`), so
 * ordering by it is safe and gives deterministic export byte-for-byte given
 * unchanged data.
 */
export async function exportDatabase(
  client: DatabaseClient,
): Promise<{ payload: ExportPayload; rowCounts: Record<string, number> }> {
  const graph = readSchemaGraph();
  const order = topologicalOrder(graph);

  const tables: Record<string, ExportedTable> = {};
  const rowCounts: Record<string, number> = {};

  for (const model of order) {
    if (EXCLUDED_MODELS.has(model.name)) continue;
    const rows = await readModelRows(client, model);
    tables[model.name] = { columns: model.columns, rows };
    rowCounts[model.name] = rows.length;
  }

  return { payload: { tables }, rowCounts };
}

async function readModelRows(
  client: DatabaseClient,
  model: ModelInfo,
): Promise<SerializedRow[]> {
  const columnList = model.columns.map((c) => `"${c}"`).join(", ");
  const orderClause = model.primaryKeyColumn
    ? ` ORDER BY "${model.primaryKeyColumn}"`
    : "";
  const sql = `SELECT ${columnList} FROM "${model.name}"${orderClause}`;
  const rows = await client.$queryRawUnsafe<RawRow[]>(sql);
  return rows.map((row) => serializeRow(row, model.columns));
}

/** Serializes an {@link ExportPayload} to bytes for the archive body. */
export function encodeExportPayload(payload: ExportPayload): Buffer {
  return Buffer.from(JSON.stringify(payload), "utf8");
}
