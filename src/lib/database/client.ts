/**
 * Prisma Client singleton.
 *
 * Standard Next.js pattern: a single PrismaClient instance is cached on the
 * global object in development so hot-reload / route re-evaluation does not
 * open a new connection pool on every reload and exhaust PostgreSQL
 * connections. In production a fresh module scope is used per server instance.
 *
 * Prisma 7 (Rust-free query compiler) connects through a driver adapter rather
 * than a bundled engine. We use @prisma/adapter-pg over `node-postgres`, fed
 * from DATABASE_URL — the same connection string the Prisma CLI uses via
 * prisma.config.ts, so runtime and migrations share one source of truth.
 *
 * There is deliberately NO fallback connection string (D-037): a missing
 * DATABASE_URL throws here rather than silently connecting somewhere else. For
 * a system holding children's records, "connected to the wrong database" must
 * never be a quiet outcome.
 *
 * IMPORTANT: import the client from the GENERATED path (Prisma 7 no longer
 * publishes it as `@prisma/client`). The generated output lives at
 * src/generated/prisma (see prisma/schema.prisma `generator client.output`).
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  // Fail fast and loudly rather than silently connecting to the wrong place.
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * The base Prisma client.
 *
 * There is no tenant-scoping extension on it and there never will be: phase 0.3
 * removed the multi-tenant machinery rather than leaving it unused (D-056), and
 * one organisation per installation means there is no tenant filter to inject.
 *
 * What replaces it is NOT "query freely". `05-technical.md` §5 requires every
 * list query to take a `Reach` from `resolveReach()` as a required repository
 * argument (D-031), and §3.1 requires each module's `infrastructure/` to expose
 * a client narrowed to the models that module OWNS, so `planning` physically
 * cannot reach `scheduledSession` (D-057).
 *
 * HALF OF THAT NOW EXISTS. `Reach` and `resolveReach` are built
 * (`@/lib/authorization`, phase 0.4b), so a repository CAN take a reach as a
 * required argument today, and a repository that ignores a variant fails to
 * compile.
 *
 * PHASE 1: the per-module NARROWED clients (D-057) and the lint rule that makes
 * importing this client from a domain module a build failure. Both are about
 * module boundaries rather than about authorization, and there is no domain
 * module to narrow a client for yet.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
