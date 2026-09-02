/**
 * Data-access entry point.
 *
 * Import the Prisma client and the generated enums from here (`@/lib/database`)
 * rather than reaching into `@/generated/prisma/client` directly, so the
 * generated output stays an implementation detail of this folder.
 *
 * The template's `organization-scope.ts` (`forOrganization` / `forPrincipal` /
 * `ORG_SCOPED_MODELS`) is deliberately NOT extracted. Two reasons, both
 * decisive: it is the tenant-scoping machinery D-056 removes, and it imports
 * the `Reach` type from the scope model, which is phase 0.4. Bringing it across
 * now would mean bringing a half-matching `Reach` with it. The tenant-aware
 * MODELS are in `prisma/schema.prisma` unchanged, so phase 0.3's removal is
 * still a reviewable diff against a faithful starting point.
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
  OrganizationStatus,
  UserAccountStatus,
  MembershipStatus,
  SessionMfaEvidence,
} from "@/generated/prisma/client";
