/**
 * Data-access entry point.
 *
 * Import the Prisma client and the generated enums from here (`@/lib/database`)
 * rather than reaching into `@/generated/prisma/client` directly, so the
 * generated output stays an implementation detail of this folder.
 *
 * The template's `organization-scope.ts` (`forOrganization` / `forPrincipal` /
 * `ORG_SCOPED_MODELS`) was never extracted, and phase 0.3 has now removed the
 * models it would have scoped (D-056). There is no tenant filter to inject and
 * nothing to inject it into.
 *
 * That is NOT a licence to query freely. `05-technical.md` §5 requires every
 * list query over person data to take a `Reach` from `resolveReach()` as a
 * required repository argument (D-031), and §3.1 requires each module's
 * `infrastructure/` to expose a client narrowed to the models that module OWNS
 * (D-057). Both are phase 0.4.
 */
export { prisma } from "./client";

/**
 * Either the base client or an interactive-transaction client.
 *
 * Take this (rather than importing `prisma` directly) in any helper a caller
 * might need to run INSIDE their own transaction — a guard whose check and
 * write must be atomic is the usual reason. Passing `tx` is what puts the
 * helper under the caller's isolation level; a helper that reaches for the
 * module-level `prisma` instead silently runs in its OWN autocommit
 * transaction, which is exactly how a check-then-write race gets reintroduced.
 */
export type DatabaseClient =
  | typeof import("./client").prisma
  | import("@/generated/prisma/client").Prisma.TransactionClient;

// Re-export generated Prisma types/enums so callers import from one place
// (`@/lib/database`) rather than reaching into the generated output directory.
export {
  Prisma,
  UserAccountStatus,
  SessionMfaEvidence,
} from "@/generated/prisma/client";
