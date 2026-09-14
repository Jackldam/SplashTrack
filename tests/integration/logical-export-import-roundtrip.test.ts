/**
 * D-169's round-trip guard: "export a seeded database, import it into an
 * empty one, and assert row counts per table, primary keys preserved exactly
 * … every encrypted column decrypting to known plaintext."
 *
 * TWO REAL, THROWAWAY DATABASES, migrated and grant-applied exactly the way a
 * real installation is (`setup:init` for the source; migrate+grants only, no
 * seed, for the target — the target must start genuinely empty, the same
 * precondition `logical-import.ts` documents). The export/import functions
 * under test take a `DatabaseClient` (`{ $queryRawUnsafe, $executeRawUnsafe }`);
 * a thin wrapper here adapts a plain `pg.Client` to that shape so this file
 * does not need its own `PrismaClient` construction.
 */

import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { open, seal } from "@/lib/crypto/envelope";
import {
  applyRoleModelOrThrow,
  migrateAndApplyRoleModel,
} from "@/lib/boot/migrate";
import { claimSchemaForOwner } from "@/lib/database/apply-role-model";
import { REFERENCE_OWNER_ROLE } from "@/lib/database/role-model";
import type { DatabaseClient } from "@/lib/database";
import { exportDatabase } from "@/modules/backup/infrastructure/logical-export";
import { importDatabase } from "@/modules/backup/infrastructure/logical-import";

import { runSplashtrackCli } from "../support/cli-runner";

const created: string[] = [];

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = "/postgres";
  return url.toString();
}

function maintenanceUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_MAINTENANCE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

function runtimeUrlFor(database: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createEmptyDatabase(suffix: string): Promise<string> {
  const database = `splashtrack_backuproundtrip_${suffix}_test`;
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${database}"`);
    await client.query(`CREATE DATABASE "${database}"`);
  });
  await claimSchemaForOwner(maintenanceUrlFor(database), REFERENCE_OWNER_ROLE);
  created.push(database);
  return database;
}

/** Adapts a `pg.Client` to the two raw-query methods `logical-export.ts` /
 * `logical-import.ts` actually use. */
function asDatabaseClient(client: Client): DatabaseClient {
  return {
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      const result = await client.query(sql, params);
      return result.rows;
    },
    async $executeRawUnsafe(sql: string, ...params: unknown[]) {
      const result = await client.query(sql, params);
      return result.rowCount ?? 0;
    },
  } as unknown as DatabaseClient;
}

/** Migrates and grant-applies a throwaway database WITHOUT seeding it — the
 * precondition `logical-import.ts` requires of its target. Reuses
 * `@/lib/boot/migrate`'s own functions by pointing `process.env` at the
 * target for the duration of the call; both read the environment at call
 * time, not import time (see their own doc comments). */
async function migrateWithoutSeeding(database: string): Promise<void> {
  const savedDatabaseUrl = process.env.DATABASE_URL;
  const savedMaintenanceUrl = process.env.DATABASE_MAINTENANCE_URL;
  process.env.DATABASE_URL = runtimeUrlFor(database);
  process.env.DATABASE_MAINTENANCE_URL = maintenanceUrlFor(database);
  try {
    await migrateAndApplyRoleModel();
  } finally {
    process.env.DATABASE_URL = savedDatabaseUrl;
    process.env.DATABASE_MAINTENANCE_URL = savedMaintenanceUrl;
  }
  void applyRoleModelOrThrow; // re-applied inside migrateAndApplyRoleModel; imported for clarity of intent
}

async function asRuntime<T>(
  database: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: runtimeUrlFor(database) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  for (const database of created) {
    await withAdmin((client) =>
      client.query(`DROP DATABASE IF EXISTS "${database}"`),
    );
  }
});

describe("logical export → import round trip (D-169)", () => {
  it(
    "row counts, primary keys and an encrypted column all survive, importing into a genuinely empty freshly-migrated database",
    { timeout: 180_000 },
    async () => {
      const source = await createEmptyDatabase("source");
      const target = await createEmptyDatabase("target");

      // SOURCE: migrated, grant-applied AND seeded (Organization + the
      // Permission/Role catalogue), via the real `setup:init` — the same
      // command a fresh installation runs.
      runSplashtrackCli(
        {
          databaseUrl: runtimeUrlFor(source),
          maintenanceUrl: maintenanceUrlFor(source),
        },
        ["setup:init"],
      );

      // One row exercising the encrypted-column path end to end: a Person
      // and a PersonRelationship whose `evidence` is sealed exactly the way
      // `people`'s application service seals it.
      const personId = "roundtrip_person_1";
      const relationshipId = "roundtrip_relationship_1";
      const plaintext = "Established by court order, filed 2024-03-01.";
      const sealedEvidence = seal(
        "person_relationships.authority_evidence",
        relationshipId,
        plaintext,
      );

      await asRuntime(source, async (client) => {
        await client.query(
          `INSERT INTO "Person" (id, "givenName", "familyName", "createdAt", "updatedAt")
             VALUES ($1, 'Ronde', 'Tafel', now(), now())`,
          [personId],
        );
        // A second person as the relationship's "related" party.
        await client.query(
          `INSERT INTO "Person" (id, "givenName", "familyName", "createdAt", "updatedAt")
             VALUES ($1, 'Andere', 'Ouder', now(), now())`,
          [`${personId}_b`],
        );
        await client.query(
          `INSERT INTO "PersonRelationship"
             (id, "fromPersonId", "toPersonId", type, authority, evidence, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, 'GUARDIAN_OF', true, $4, now(), now())`,
          [relationshipId, `${personId}_b`, personId, sealedEvidence],
        );
      });

      // Export the source AS THE RUNTIME ROLE (the identity the real backup
      // service will use — see `application/backup-service.ts`).
      const { payload, rowCounts: sourceRowCounts } = await asRuntime(
        source,
        (client) => exportDatabase(asDatabaseClient(client)),
      );

      expect(sourceRowCounts.Person).toBeGreaterThanOrEqual(2);
      expect(sourceRowCounts.PersonRelationship).toBe(1);
      expect(sourceRowCounts.Permission).toBeGreaterThan(0);
      expect(sourceRowCounts.Role).toBe(2); // instance_administrator, self

      // TARGET: migrated and grant-applied, deliberately NOT seeded — the
      // precondition importDatabase documents.
      await migrateWithoutSeeding(target);
      await asRuntime(target, async (client) => {
        const organizations = await client.query(
          'SELECT 1 FROM "Organization"',
        );
        expect(organizations.rowCount).toBe(0);
      });

      const warnings: string[] = [];
      const { rowCounts: importedRowCounts } = await asRuntime(
        target,
        (client) =>
          importDatabase(asDatabaseClient(client), payload, (w) =>
            warnings.push(w),
          ),
      );

      // No unexpected column drift between source and target schema — both
      // were migrated from the SAME checkout, so any warning here is a bug.
      expect(warnings).toEqual([]);

      // Row counts match exactly, per table.
      for (const [table, count] of Object.entries(sourceRowCounts)) {
        expect(importedRowCounts[table], `row count for "${table}"`).toBe(
          count,
        );
      }

      await asRuntime(target, async (client) => {
        // Primary keys preserved EXACTLY (D-169's own requirement).
        const person = await client.query(
          'SELECT id, "givenName" FROM "Person" WHERE id = $1',
          [personId],
        );
        expect(person.rows).toEqual([{ id: personId, givenName: "Ronde" }]);

        // The encrypted column decrypts to the known plaintext, through the
        // SAME `open()` the application uses — proving the envelope, the AAD
        // (bound to the row's own primary key) and the row's id all survived
        // the round trip together.
        const relationship = await client.query<{ evidence: string }>(
          'SELECT evidence FROM "PersonRelationship" WHERE id = $1',
          [relationshipId],
        );
        expect(relationship.rows).toHaveLength(1);
        const decrypted = open(
          "person_relationships.authority_evidence",
          relationshipId,
          relationship.rows[0].evidence,
        );
        expect(decrypted).toBe(plaintext);

        // The seeded catalogue came across too.
        const roles = await client.query<{ key: string }>(
          'SELECT key FROM "Role" ORDER BY key',
        );
        expect(roles.rows.map((r) => r.key)).toEqual([
          "instance_administrator",
          "self",
        ]);
      });
    },
  );
});
