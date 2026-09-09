// Prisma 7 CLI configuration.
//
// In Prisma 7 the connection string used by the Prisma CLI (migrate / db pull /
// db push / studio) is configured HERE, not inside schema.prisma.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CLI DOES NOT USE `DATABASE_URL`, AND THAT IS THE WHOLE OF ADR-0002
//
// It uses `DATABASE_MAINTENANCE_URL`, with `options=-c role=splashtrack_owner`
// added by `migrationUrlFrom`. Two consequences, both deliberate:
//
//   1. Every table a migration creates is owned by `splashtrack_owner`, a role
//      that CANNOT LOG IN and appears in no connection string anywhere. That is
//      the precondition D-149 part 2 never stated. Without it the REVOKE of
//      UPDATE/DELETE on `AuditEvent` is decorative — an owner holds privileges
//      by ownership rather than by grant and re-grants them to itself in one
//      statement (ADR-0002 §3). Against the actor D-149 names — an external SQL
//      primitive — that buys one statement of delay while reading as though it
//      buys the property.
//
//   2. The runtime role in `DATABASE_URL` cannot migrate, which is correct:
//      D-116 makes it a role that owns nothing.
//
// The Prisma CLI is a migration tool here, so the maintenance credential is the
// right one for all of it. `prisma studio` opening as the owner is the same
// call: it is an operator's tool, reached from the host.
//
// `DATABASE_MAINTENANCE_URL` is the second of the two application-owned
// variables D-182 fixes the count at, and ADR-0002 §8 is the ADR D-037 requires
// for it. There is deliberately NO default for either — a missing value is a
// loud failure, never a silent connection to the wrong place.
//
// `dotenv/config` loads the local .env for CLI invocations; Next.js loads .env
// itself at application runtime.
//
// No `seed` entry yet: there is no domain model to seed. It is added with the
// first module, alongside the synthetic DEV dataset D-023 requires.
import "dotenv/config";
import { defineConfig } from "prisma/config";

import {
  migrationUrlFrom,
  REFERENCE_OWNER_ROLE,
} from "./src/lib/database/role-model";

function migrationUrl(): string {
  const maintenance = process.env.DATABASE_MAINTENANCE_URL;
  if (!maintenance) {
    throw new Error(
      "DATABASE_MAINTENANCE_URL is not set, so the Prisma CLI has no " +
        "connection to migrate with.\n\n" +
        "  Migrations do not run as DATABASE_URL's role: that role owns " +
        "nothing, deliberately (ADR-0002 §3, D-116). They run as the " +
        "maintenance credential, acting as the schema owner.\n\n" +
        "  Copy .env.example to .env and fill in both connection strings.",
    );
  }
  return migrationUrlFrom(
    maintenance,
    process.env.SPLASHTRACK_OWNER_ROLE ?? REFERENCE_OWNER_ROLE,
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl(),
  },
});
