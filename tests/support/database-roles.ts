/**
 * Clients for the roles the application is NOT supposed to connect as
 * (ADR-0002), for the tests that need them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE EXIST, AND WHY IT IS A GOOD SIGN THAT THEY DO
 *
 * Several suites tamper with the audit trail on purpose — an edited row, a
 * deleted row with no covering checkpoint, a forged checkpoint — because the
 * thing under test is that `verifyAuditChain` CATCHES it. Before ADR-0002 those
 * tests could do the tampering on the ordinary runtime client, and that was
 * itself the finding: the runtime role could rewrite the record of what it had
 * done.
 *
 * It no longer can, so the tampering now needs a role that has beaten the
 * database controls. That is the correct model of the attacker those tests are
 * about: the hash chain is defence in DEPTH, behind the role model, and it must
 * still catch someone who got past the first layer. Making the tests reach for
 * `ownerClient()` states plainly which layer each one is testing.
 *
 * Several others need `TRUNCATE` to reset between cases. No application role
 * holds `TRUNCATE` on `AuditEvent` — not the runtime role, which is
 * append-only, and not the retention role, which may only `DELETE` behind a
 * checkpoint (D-168). Only the owner can, and only a test harness ever should.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THEY ARE STILL PINNED TO THE `_test` DATABASE
 *
 * Both read the connection `tests/setup/test-env.ts` already forced through the
 * `_test`-suffix guard, so nothing here widens the blast radius: a client that
 * can TRUNCATE the audit trail is exactly the client that must never be able to
 * reach the development database.
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "@/lib/database/role-model";

const clients: PrismaClient[] = [];

function maintenanceUrl(): string {
  const url = process.env.DATABASE_MAINTENANCE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set; tests/setup/test-env.ts did not " +
        "run. It is what pins this connection to the `_test` database.",
    );
  }
  return url;
}

/**
 * A client acting as `splashtrack_owner` — the only identity that may TRUNCATE
 * the audit tables or rewrite a row in them.
 *
 * Use it for TEST SETUP and for deliberate tamper simulation, never to stand in
 * for something the application does. If a test needs this to exercise an
 * application path, the application path is wrong.
 */
export function ownerClient(): PrismaClient {
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: migrationUrlFrom(
        maintenanceUrl(),
        REFERENCE_OWNER_ROLE,
      ),
    }),
  });
  clients.push(client);
  return client;
}

/**
 * A client acting as `splashtrack_retention` — `SELECT`, `INSERT` and `DELETE`
 * on `AuditEvent`, and nothing on any other table.
 *
 * This is the role the retention path really runs as, so a test using it is
 * testing the real thing rather than an approximation of it.
 */
export function retentionClient(): PrismaClient {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenanceUrl() }),
  });
  clients.push(client);
  return client;
}

/** Closes every client handed out. Call from `afterAll`. */
export async function disconnectRoleClients(): Promise<void> {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
}
