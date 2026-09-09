/**
 * `Reach` — the read side of authorization — and `resolveReach`, its only
 * producer (D-147).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE TYPE AND ITS RESOLVER SHARE ONE FILE
 *
 * D-147 requires that a `Reach` be **constructible only by `resolveReach`**, and
 * `06-delivery.md` §2.1 makes "a `Reach` cannot be constructed outside
 * `resolveReach()`" a per-module gate asserted **structurally, not by
 * convention**.
 *
 * A brand in one module and a resolver in another cannot have that property:
 * the constructors would have to be exported for the resolver to reach them,
 * and an exported constructor is a constructor. So the brand, every constructor
 * and the resolver live here, module-private, and this file exports no way to
 * make one. That is the whole reason for its length.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OLD SHAPE GOT WRONG (F-112)
 *
 * The earlier signature returned `{ units, groups, all }`. The scope enum has
 * six members; that object represented two of them plus a boolean. An internal
 * examiner (`COURSE`) or an aftest assessor (`SESSION`) resolved to
 * `{units: [], groups: [], all: false}` — empty reach, every list denies them,
 * and the candidate list they are physically standing there to assess is blank.
 * The developer fixing that at 17:00 on an exam Saturday widens the object ad
 * hoc or passes `{all: true}`, on the code path D-031 calls the highest-risk in
 * the application.
 *
 * Two defects, both fixed here:
 *   - **Incomplete coverage of the scope enum.** One variant per scope type,
 *     plus `NONE` and `UNION`. There is no `all: boolean`: organisation-wide
 *     reach is a VARIANT only an `ORGANIZATION` grant can produce, so
 *     "everything" is a resolution outcome rather than a field anyone can set.
 *   - **Forgeability.** D-031 claimed a required argument "turns a silent
 *     over-fetch into a type error"; a required argument enforces PRESENCE, and
 *     `{units: [], groups: [], all: true}` was a valid literal TypeScript would
 *     accept anywhere a reach was required. The compiler was checking that the
 *     question was asked, not that it was answered by the authority.
 *
 * The brand is enforced at BOTH levels, deliberately: a non-exported
 * `unique symbol` field makes a literal a compile error, and the same symbol is
 * a real runtime property, so a `value as Reach` cast — the one escape a purely
 * type-level brand leaves open — is caught by `assertIsReach` at the point of
 * use rather than silently widening a query.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

import { HIGH_RISK_PERMISSIONS, type PermissionKey } from "./permissions";
import type { ScopeType } from "./scope";
import {
  ScopeRelationUnavailableError,
  scopeRelations,
} from "./scope-relations";

// ---------------------------------------------------------------------------
// The brand. NOT exported, and it must never be.
// ---------------------------------------------------------------------------

const REACH_BRAND: unique symbol = Symbol("splashtrack.authorization.reach");

type ReachBrand = { readonly [REACH_BRAND]: true };

/** The window a `SESSIONS` reach is valid for — the grant's own validity. */
export interface ReachWindow {
  readonly from: Date;
  /** Never null: `validUntil` is schema-mandatory for `SESSION` (D-144). */
  readonly until: Date;
}

/**
 * The shape of a reach, WITHOUT the brand. This is what a repository switches
 * on after calling `reachVariant()`. It is exported so a repository can be
 * exhaustive; it cannot be assigned to `Reach`, so exporting it grants nothing.
 */
export type ReachVariant =
  /** Every resource in the installation. Producible only by an `ORGANIZATION` grant. */
  | { readonly kind: "ORGANIZATION" }
  | { readonly kind: "UNITS"; readonly unitIds: readonly string[] }
  | { readonly kind: "GROUPS"; readonly groupIds: readonly string[] }
  | { readonly kind: "COURSES"; readonly courseIds: readonly string[] }
  | {
      readonly kind: "SESSIONS";
      readonly sessionIds: readonly string[];
      readonly window: ReachWindow;
    }
  | { readonly kind: "SELF"; readonly personId: string }
  /** The honest result of holding no grant — distinguishable in code AND in logs. */
  | { readonly kind: "NONE" }
  /** Effective reach is a union of grants (§2.1). */
  | { readonly kind: "UNION"; readonly of: readonly Reach[] };

/**
 * An opaque, branded reach. Produced only by `resolveReach`.
 *
 * A repository accepts one and translates each variant into a `where` clause; a
 * repository that does not handle a variant fails to compile rather than
 * returning unfiltered rows. That is D-147's intended cost: a genuinely new
 * scope type becomes a compile error in every repository at once.
 */
export type Reach = ReachVariant & ReachBrand;

function brand(variant: ReachVariant): Reach {
  return Object.freeze({ ...variant, [REACH_BRAND]: true }) as Reach;
}

// ---------------------------------------------------------------------------
// The safe read side
// ---------------------------------------------------------------------------

/** True when this value really was produced here. */
export function isReach(value: unknown): value is Reach {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[REACH_BRAND] === true
  );
}

export class ForgedReachError extends Error {
  constructor() {
    super(
      "This value is not a Reach produced by resolveReach(). A Reach is opaque " +
        "and has exactly one producer (D-147); a cast or a hand-built literal " +
        "is not one, and widening reach 'temporarily' is how a scoped query " +
        "returns another instructor's children.",
    );
    this.name = "ForgedReachError";
  }
}

/** Refuses anything that did not come from `resolveReach`. */
export function assertIsReach(value: unknown): asserts value is Reach {
  if (!isReach(value)) throw new ForgedReachError();
}

/**
 * The variant, for an exhaustive switch. Cannot be turned back into a `Reach`.
 *
 * It returns a COPY with the brand removed, rather than the reach itself. That
 * is not tidiness: spreading a branded object — `{ ...reach, kind:
 * "ORGANIZATION" }` — copies the symbol property too, so returning the original
 * would leave a one-line forgery path through an ordinary-looking spread. The
 * copy also keeps `toEqual` in a test honest about what a variant is.
 */
export function reachVariant(reach: Reach): ReachVariant {
  assertIsReach(reach);
  const copy = { ...(reach as object) } as Record<PropertyKey, unknown>;
  delete copy[REACH_BRAND];
  return copy as unknown as ReachVariant;
}

/** True when this principal reaches nothing at all. */
export function isEmptyReach(reach: Reach): boolean {
  const variant = reachVariant(reach);
  if (variant.kind === "NONE") return true;
  if (variant.kind === "UNION") return variant.of.every(isEmptyReach);
  return false;
}

/**
 * A stable, log-safe summary. `NONE` prints as `NONE`, so "this principal
 * reaches nothing" stays distinguishable from "reach was never resolved" in a
 * log line as well as in code (D-147).
 */
export function describeReach(reach: Reach): string {
  const variant = reachVariant(reach);
  switch (variant.kind) {
    case "ORGANIZATION":
      return "ORGANIZATION";
    case "NONE":
      return "NONE";
    case "UNITS":
      return `UNITS(${variant.unitIds.length})`;
    case "GROUPS":
      return `GROUPS(${variant.groupIds.length})`;
    case "COURSES":
      return `COURSES(${variant.courseIds.length})`;
    case "SESSIONS":
      return `SESSIONS(${variant.sessionIds.length})`;
    case "SELF":
      return "SELF";
    case "UNION":
      return `UNION[${variant.of.map(describeReach).join(",")}]`;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Who is asking. A person today; a machine caller when a credential path exists. */
export interface Principal {
  readonly personId: string;
}

export interface ResolveReachOptions {
  /**
   * The instant coverage is evaluated at. Defaults to now. Passing it makes
   * expiry testable without waiting, and makes a single request evaluate every
   * grant against one consistent instant.
   */
  readonly at?: Date;
  /** The client to read grants through — a transaction, in a grant service. */
  readonly client?: Pick<PrismaClient, "roleAssignment">;
}

/**
 * A principal's effective reach for one permission, evaluated live.
 *
 * Resolution, in order:
 *   1. Read every `RoleAssignment` for this person whose role carries the
 *      permission — directly through `RolePermission`, or through an
 *      `AccessGroup` the role includes. An access group is a PROJECTION and
 *      never a second source of truth (§2.7), so it is expanded here rather
 *      than consulted separately.
 *   2. Drop every grant outside its validity window. **Expiry is enforced here
 *      and in `requirePermission`, never by a cleanup job** (D-144): a job that
 *      has not run yet is an open grant, and a predicate cannot be behind
 *      schedule.
 *   3. Map each surviving grant to its variant, applying the live relation
 *      rules — for `GROUP`, the holder's `InstructorAssignment` must be active
 *      NOW (D-145 rule 1).
 *   4. Merge and return. Zero grants ⇒ `NONE`, which is a resolution outcome
 *      and not an error.
 *
 * Deny by default on ANY failure (§1.1 rule 2). A database that is unreachable,
 * a relation nobody registered, a malformed row — all of them produce `NONE`,
 * logged at error level with the cause. Nothing ambiguous becomes an allow.
 */
export async function resolveReach(
  principal: Principal,
  permission: PermissionKey,
  options: ResolveReachOptions = {},
): Promise<Reach> {
  const at = options.at ?? new Date();
  const client = options.client ?? prisma;

  let grants: {
    scopeType: ScopeType;
    scopeId: string | null;
    validFrom: Date;
    validUntil: Date | null;
  }[];

  try {
    grants = await client.roleAssignment.findMany({
      where: {
        personId: principal.personId,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        role: {
          OR: [
            { permissions: { some: { permission: { key: permission } } } },
            {
              accessGroups: {
                some: {
                  accessGroup: {
                    permissions: { some: { permission: { key: permission } } },
                  },
                },
              },
            },
          ],
        },
      },
      select: {
        scopeType: true,
        scopeId: true,
        validFrom: true,
        validUntil: true,
      },
    });
  } catch (error) {
    logger.error(
      {
        component: "authorization",
        event: "reach.resolution_failed",
        personId: principal.personId,
        permission,
        err: error,
      },
      "reach resolution failed — denying",
    );
    return brand({ kind: "NONE" });
  }

  const unitIds = new Set<string>();
  const groupIds = new Set<string>();
  const courseIds = new Set<string>();
  /** Session grants keyed by their window, since each grant carries its own. */
  const sessionsByWindow = new Map<
    string,
    { window: ReachWindow; ids: Set<string> }
  >();
  let organization = false;
  let self = false;

  // Resolved once, not per grant: a principal may hold several GROUP grants and
  // the answer is the same for all of them.
  let activeInstructorGroups: ReadonlySet<string> | null = null;
  const needsGroups = grants.some((grant) => grant.scopeType === "GROUP");
  if (needsGroups) {
    try {
      activeInstructorGroups = new Set(
        await scopeRelations().activeInstructorGroupIds(principal.personId, at),
      );
    } catch (error) {
      // Deny the GROUP half and keep the rest. A principal holding an
      // ORGANIZATION grant and a GROUP grant on an instance where the groups
      // module is not wired up still resolves their organisation reach.
      activeInstructorGroups = new Set();
      logger[error instanceof ScopeRelationUnavailableError ? "warn" : "error"](
        {
          component: "authorization",
          event: "reach.group_relation_unavailable",
          personId: principal.personId,
          permission,
          err: error,
        },
        "GROUP reach denied — the active-instructor relation could not be read",
      );
    }
  }

  for (const grant of grants) {
    switch (grant.scopeType) {
      case "ORGANIZATION":
        organization = true;
        break;
      case "SELF":
        self = true;
        break;
      case "UNIT":
        if (grant.scopeId) unitIds.add(grant.scopeId);
        break;
      case "GROUP":
        // D-145 rule 1: an active InstructorAssignment at QUERY TIME, not at
        // grant time. The append-only membership history grants nothing.
        if (grant.scopeId && activeInstructorGroups?.has(grant.scopeId)) {
          groupIds.add(grant.scopeId);
        }
        break;
      case "COURSE":
        if (grant.scopeId) courseIds.add(grant.scopeId);
        break;
      case "SESSION": {
        // validUntil is schema-mandatory for SESSION, so a null here is a row
        // that got past the CHECK constraint. Deny it rather than inventing a
        // window.
        if (!grant.scopeId || !grant.validUntil) break;
        const window: ReachWindow = {
          from: grant.validFrom,
          until: grant.validUntil,
        };
        const key = `${window.from.toISOString()}..${window.until.toISOString()}`;
        const bucket = sessionsByWindow.get(key) ?? { window, ids: new Set() };
        bucket.ids.add(grant.scopeId);
        sessionsByWindow.set(key, bucket);
        break;
      }
    }
  }

  // ORGANIZATION absorbs everything else: it covers every resource in the
  // installation, so a union with it carries no extra information and a
  // repository would only have to flatten it again.
  if (organization) return brand({ kind: "ORGANIZATION" });

  const variants: ReachVariant[] = [];
  if (unitIds.size > 0) variants.push({ kind: "UNITS", unitIds: [...unitIds] });
  if (groupIds.size > 0)
    variants.push({ kind: "GROUPS", groupIds: [...groupIds] });
  if (courseIds.size > 0)
    variants.push({ kind: "COURSES", courseIds: [...courseIds] });
  for (const { window, ids } of sessionsByWindow.values()) {
    variants.push({ kind: "SESSIONS", sessionIds: [...ids], window });
  }
  if (self) variants.push({ kind: "SELF", personId: principal.personId });

  if (variants.length === 0) return brand({ kind: "NONE" });
  if (variants.length === 1) return brand(variants[0]);
  return brand({ kind: "UNION", of: variants.map(brand) });
}

/**
 * Does this principal hold any permission in the high-risk set, at ANY scope?
 *
 * The predicate three separate rules bind to and none of them could compute
 * before now (D-130, D-173, §1.2): the MFA mandate, the security alert rules,
 * and the selection between the standard and the ELEVATED session idle window.
 * All three bind to permissions rather than to role names, because a school that
 * invents *Hulpinstructeur* must not thereby fall off a security control.
 *
 * Deliberately NOT resource-referenced, and that is not a D-030 exception:
 * D-030 governs whether a principal may ACT on a resource. This asks a question
 * about the principal themselves — "is this account dangerous enough to deserve
 * the short window" — and §1.2 states it at *any* scope precisely because
 * holding `students.medical.read` over one group is enough to make the session
 * worth protecting.
 *
 * Fails toward STRICT: any error returns `true`, so a database blip gives the
 * shorter window rather than the longer one. That is the opposite of every
 * other denial in this file, and it is the same direction — the strict answer.
 */
export async function holdsAnyHighRiskPermission(
  principal: Principal,
  options: ResolveReachOptions = {},
): Promise<boolean> {
  const at = options.at ?? new Date();
  const client = options.client ?? prisma;

  try {
    const found = await client.roleAssignment.findFirst({
      where: {
        personId: principal.personId,
        validFrom: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        role: {
          OR: [
            {
              permissions: {
                some: {
                  permission: { key: { in: [...HIGH_RISK_PERMISSIONS] } },
                },
              },
            },
            {
              accessGroups: {
                some: {
                  accessGroup: {
                    permissions: {
                      some: {
                        permission: { key: { in: [...HIGH_RISK_PERMISSIONS] } },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
      select: { id: true },
    });
    return found !== null;
  } catch (error) {
    logger.error(
      {
        component: "authorization",
        event: "high_risk.resolution_failed",
        personId: principal.personId,
        err: error,
      },
      "high-risk membership could not be resolved — failing to STRICT",
    );
    return true;
  }
}
