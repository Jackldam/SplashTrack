// Prisma 7 CLI configuration.
//
// In Prisma 7 the connection string used by the Prisma CLI (migrate / db pull /
// db push / studio) is configured HERE, not inside schema.prisma. It resolves
// from env("DATABASE_URL") — see .env.example — so there is a single source of
// truth for the connection string, shared with the runtime client, which reads
// the same variable through the @prisma/adapter-pg driver adapter
// (src/lib/database/client.ts).
//
// DATABASE_URL is one of the three application-owned environment variables
// D-037 permits: it must be known before the database can be read. There is
// deliberately NO default value anywhere — a missing DATABASE_URL is a loud
// boot failure, never a silent connection to the wrong place.
//
// `dotenv/config` loads the local .env for CLI invocations; Next.js loads .env
// itself at application runtime.
//
// No `seed` entry yet: there is no domain model to seed. It is added with the
// first module, alongside the synthetic DEV dataset D-023 requires.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
