/**
 * The grant invariants — no amplification, no scope escape by grant (§2.6, as
 * completed by §2.6.1).
 *
 * Without these, every other control in the security chapter is decorative. A
 * Location Manager opens People & roles, assigns themselves an
 * `ORGANIZATION`-scoped administrator role or an access group containing
 * `students.medical.read`, and holds every medical note in the swim school.
 * Step-up is no obstacle — it is their own password and their own second factor
 * — and the audit event records a role change that looks entirely legitimate.
 * F-109.
 *
 * **Three invariants, checked on every path that creates or modifies a
 * `RoleAssignment`, an `AccessGroup` assignment, or a `Role`'s permission set**
 * (D-139). Editing a role is a grant to everyone holding it; an `AccessGroup`
 * bundles permissions PLUS scopes into one assignable object and would
 * otherwise be a clean bypass of all three (§2.7). So this function takes a
 * LIST of expanded `(permission, scope, window)` proposals rather than a single
 * grant: the roles module expands a role's permission set, the access-groups
 * module expands a group's contents, and all three paths get one implementation.
 *
 * **Enforced in the grant service, not in the UI** (§1.1 rule 1: hiding a button
 * is not authorization).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO SCOPE-TYPE RANKING (D-170)
 *
 * D-139 said "at or below their own scope". That phrase appears once in the
 * design set and no chapter defines a partial order over the six scope types.
 * The obvious implementation is a breadth ranking —
 * `ORGANIZATION > UNIT > COURSE > GROUP > SESSION > SELF`, because a course
 * names fewer resources than a unit — and §2.1 places `COURSE` **across** units.
 * So a `UNIT`-scoped Location Manager at Zuidbad, holding `exams.manage` and
 * `roles.assign` there, grants themselves `exams.results.record` at
 * `COURSE = Diploma B`; `COURSE` ranks "below" `UNIT`, every check passes, and
 * their reach now covers Diploma B's exam sessions **at Noordbad**, where D-062
 * makes their amendment the effective result. The mirror failure is equally
 * available: rank `UNIT > GROUP` with no slot for `SESSION` and every
 * legitimate delegation to an aftest assessor is denied, with the 17:00 fix on
 * an exam Saturday being a special case in this file. F-139.
 *
 * So confinement is **resource containment**: is the set of resources the
 * proposed grant would cover a subset of the set the granter's own grant of
 * that same permission covers, evaluated live? The consequences D-170 lists
 * fall out of `grantCoversScope` below rather than needing rules of their own.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

import type { PermissionKey } from "./permissions";
import type { Principal } from "./reach";
import {
  BOUNDED_WINDOW_SCOPE_TYPES,
  WINDOW_CEILING_DAYS_PAST_REFERENT,
  type ScopeType,
} from "./scope";
import {
  ScopeRelationUnavailableError,
  scopeRelations,
} from "./scope-relations";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One expanded `(permission, scope, window)` the granter proposes to create. */
export interface GrantProposal {
  readonly permission: PermissionKey;
  readonly scopeType: ScopeType;
  /** Null exactly for `ORGANIZATION` and `SELF`. */
  readonly scopeId: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

export interface GrantRequest {
  /** Who is issuing. Their own grants are what bound the proposal. */
  readonly granter: Principal;
  /** Who receives it — the subject of a `SELF` proposal, and of the audit event. */
  readonly subjectPersonId: string;
  readonly proposals: readonly GrantProposal[];
}

export interface AssertGrantableOptions {
  readonly at?: Date;
  readonly client?: Pick<PrismaClient, "roleAssignment">;
}

/** Which invariant refused, so the refusal is diagnosable and auditable. */
export type GrantRefusalReason =
  | "AMPLIFICATION"
  | "SCOPE_NOT_CONTAINED"
  | "WINDOW_NOT_CONTAINED"
  | "WINDOW_CEILING_EXCEEDED"
  | "MALFORMED_PROPOSAL"
  | "UNRESOLVABLE";

export class GrantRefusedError extends Error {
  constructor(
    public readonly reason: GrantRefusalReason,
    public readonly permission: PermissionKey,
    detail: string,
  ) {
    super(`Grant refused (${reason}) for ${permission}: ${detail}`);
    this.name = "GrantRefusedError";
  }
}

/** A live grant of the granter's, as the invariants need to see it. */
interface GranterGrant {
  readonly scopeType: ScopeType;
  readonly scopeId: string | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

/**
 * Throws unless every proposal satisfies all three invariants.
 *
 * All-or-nothing: one refused proposal refuses the whole request, because a
 * partially applied bundle is an access group that means something different
 * from what the administrator assigned.
 */
export async function assertGrantable(
  request: GrantRequest,
  options: AssertGrantableOptions = {},
): Promise<void> {
  const at = options.at ?? new Date();
  const client = options.client ?? prisma;

  for (const proposal of request.proposals) {
    assertWellFormed(proposal);

    // ── D-170's ceiling. Applied to the PROPOSAL itself, independently of the
    // granter, because it is the rule a schema CHECK would carry if the tables
    // it is computed from existed. Without it, a mandatory date field with no
    // ceiling collects `2099-12-31` on a form filled in under time pressure,
    // and B-7's examiner holds `exams.assess` for seventy-three years.
    await assertWithinCeiling(proposal);

    // ── Invariant 1: NO AMPLIFICATION. The permission being granted must be one
    // the granter holds. A Planner cannot grant `students.medical.read` because
    // they do not hold it.
    const held = await liveGrantsFor(
      client,
      request.granter.personId,
      proposal.permission,
      at,
    );
    if (held.length === 0) {
      throw new GrantRefusedError(
        "AMPLIFICATION",
        proposal.permission,
        "the granter holds no live grant of this permission at any scope",
      );
    }

    // ── Invariants 2 and 3, together. A single one of the granter's grants must
    // satisfy BOTH: its scope must contain the proposed scope, and its window
    // must contain the proposed window. Checking them against DIFFERENT grants
    // would let a granter combine a wide-scope expired grant with a narrow-scope
    // live one.
    let scopeContainedSomewhere = false;
    let satisfied = false;

    for (const grant of held) {
      let contains: boolean;
      try {
        contains = await grantCoversScope(grant, proposal, request);
      } catch (error) {
        // A containment question we cannot answer is a denial, not a pass
        // (§1.1 rule 2). Logged, because "the groups module is not registered"
        // and "this course has no groups" must be distinguishable to whoever
        // is looking at a refused grant.
        logger[
          error instanceof ScopeRelationUnavailableError ? "warn" : "error"
        ](
          {
            component: "authorization",
            event: "grant.containment_unresolvable",
            permission: proposal.permission,
            scopeType: proposal.scopeType,
            err: error,
          },
          "grant containment could not be evaluated — refusing",
        );
        throw new GrantRefusedError(
          "UNRESOLVABLE",
          proposal.permission,
          "the proposed scope's containment in the granter's own could not be " +
            "resolved; a containment question without an answer is a refusal",
        );
      }
      if (!contains) continue;
      scopeContainedSomewhere = true;

      if (windowContained(grant, proposal)) {
        satisfied = true;
        break;
      }
    }

    if (!scopeContainedSomewhere) {
      throw new GrantRefusedError(
        "SCOPE_NOT_CONTAINED",
        proposal.permission,
        `no grant of the granter's covers ${proposal.scopeType}` +
          `${proposal.scopeId ? `:${proposal.scopeId}` : ""}`,
      );
    }
    if (!satisfied) {
      throw new GrantRefusedError(
        "WINDOW_NOT_CONTAINED",
        proposal.permission,
        "the proposed validity window is not inside the granter's own window " +
          "for a grant that also covers the proposed scope",
      );
    }
  }
}

function assertWellFormed(proposal: GrantProposal): void {
  const impliesOwnScope =
    proposal.scopeType === "ORGANIZATION" || proposal.scopeType === "SELF";
  if (impliesOwnScope !== (proposal.scopeId === null)) {
    throw new GrantRefusedError(
      "MALFORMED_PROPOSAL",
      proposal.permission,
      `${proposal.scopeType} ${impliesOwnScope ? "must not" : "must"} name a scopeId`,
    );
  }
  if (
    BOUNDED_WINDOW_SCOPE_TYPES.has(proposal.scopeType) &&
    proposal.validUntil === null
  ) {
    throw new GrantRefusedError(
      "MALFORMED_PROPOSAL",
      proposal.permission,
      `${proposal.scopeType} scope requires a validUntil (D-144, D-170)`,
    );
  }
  if (
    proposal.validUntil !== null &&
    proposal.validUntil <= proposal.validFrom
  ) {
    throw new GrantRefusedError(
      "MALFORMED_PROPOSAL",
      proposal.permission,
      "validUntil must be after validFrom",
    );
  }
}

/**
 * D-170's window ceiling: `SESSION` at the session's date + 7 days, `COURSE` at
 * the course's end date + 7 days. A referent that cannot be resolved REFUSES —
 * defaulting the ceiling would put the value back under the control of the
 * person typing the date, which is the thing D-052 could never enforce.
 */
async function assertWithinCeiling(proposal: GrantProposal): Promise<void> {
  if (!BOUNDED_WINDOW_SCOPE_TYPES.has(proposal.scopeType)) return;
  // Guaranteed by assertWellFormed; narrowed for the compiler.
  const validUntil = proposal.validUntil as Date;
  const scopeId = proposal.scopeId as string;

  let referentEnd: Date | null;
  try {
    referentEnd =
      proposal.scopeType === "SESSION"
        ? await scopeRelations().sessionDate(scopeId)
        : await scopeRelations().courseEndDate(scopeId);
  } catch (error) {
    logger[error instanceof ScopeRelationUnavailableError ? "warn" : "error"](
      {
        component: "authorization",
        event: "grant.ceiling_unresolvable",
        permission: proposal.permission,
        scopeType: proposal.scopeType,
        err: error,
      },
      "window ceiling could not be resolved — refusing",
    );
    throw new GrantRefusedError(
      "UNRESOLVABLE",
      proposal.permission,
      `the ${proposal.scopeType} referent's own date could not be read, so the ` +
        "ceiling cannot be computed",
    );
  }

  if (referentEnd === null) {
    throw new GrantRefusedError(
      "UNRESOLVABLE",
      proposal.permission,
      `${proposal.scopeType}:${scopeId} has no resolvable date to bound the window against`,
    );
  }

  const ceiling = new Date(
    referentEnd.getTime() + WINDOW_CEILING_DAYS_PAST_REFERENT * DAY_MS,
  );
  if (validUntil > ceiling) {
    throw new GrantRefusedError(
      "WINDOW_CEILING_EXCEEDED",
      proposal.permission,
      `validUntil ${validUntil.toISOString()} is past the ceiling ` +
        `${ceiling.toISOString()} (referent date + ${WINDOW_CEILING_DAYS_PAST_REFERENT} days)`,
    );
  }
}

/** The granter's live grants of one permission, windows included. */
async function liveGrantsFor(
  client: Pick<PrismaClient, "roleAssignment">,
  personId: string,
  permission: PermissionKey,
  at: Date,
): Promise<GranterGrant[]> {
  return client.roleAssignment.findMany({
    where: {
      personId,
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
}

/**
 * Resource containment: does everything the proposed scope covers sit inside
 * what this one grant of the granter's covers?
 *
 * Conservative where the design does not settle it. `COURSE` does NOT contain
 * `GROUP` even for a group taught under that course: coverage is per relation
 * (D-145), and a `GROUP` grant reaches that group's attendance and progress
 * while a `COURSE` grant reaches the course's enrolments and exam sessions.
 * Neither is a subset of the other, and refusing is the direction that cannot
 * over-grant. Recorded in `docs/build/phase-0.4b-reach-and-retention-report.md`
 * §3.
 */
async function grantCoversScope(
  grant: GranterGrant,
  proposal: GrantProposal,
  request: GrantRequest,
): Promise<boolean> {
  const relations = scopeRelations();

  // Nothing else covers everything, so ORGANIZATION remains grantable only by
  // an ORGANIZATION holder (D-170).
  if (grant.scopeType === "ORGANIZATION") return true;
  if (proposal.scopeType === "ORGANIZATION") return false;

  // SELF needs no ordering: its cover is the SUBJECT's own records, which is a
  // subset of any grant that includes them (D-170). Note the subject, not the
  // granter — seeding a person their own SELF role is a grant ABOUT them.
  if (proposal.scopeType === "SELF") {
    return grantCoversPerson(grant, request.subjectPersonId);
  }
  if (grant.scopeType === "SELF") return false;

  const proposedId = proposal.scopeId as string;
  const grantId = grant.scopeId as string;

  switch (grant.scopeType) {
    case "UNIT": {
      switch (proposal.scopeType) {
        case "UNIT":
          // Flat: their own unit and nothing else (D-121). A child unit is
          // OUTSIDE a UNIT-scoped principal's reach.
          return proposedId === grantId;
        case "GROUP":
          return (await relations.unitOfGroup(proposedId)) === grantId;
        case "SESSION": {
          const group = await relations.groupOfSession(proposedId);
          if (group === null) return false;
          return (await relations.unitOfGroup(group)) === grantId;
        }
        case "COURSE": {
          // D-170's own example, stated as an executable rule: a UNIT granter
          // may grant at COURSE **only when every group in that course sits in
          // their unit**. An empty course refuses — an empty set is vacuously a
          // subset, and treating it as one would hand the granter cover over
          // every group the course acquires later, anywhere.
          const groups = await relations.groupsOfCourse(proposedId);
          if (groups.length === 0) return false;
          for (const groupId of groups) {
            if ((await relations.unitOfGroup(groupId)) !== grantId)
              return false;
          }
          return true;
        }
        default:
          return false;
      }
    }

    case "GROUP": {
      switch (proposal.scopeType) {
        case "GROUP":
          return proposedId === grantId;
        case "SESSION":
          // D-068's aftest case: a GROUP-scoped instructor delegates one
          // session on their own group's roster to an independent assessor. A
          // type ranking either permits this by accident or forbids it by
          // accident; containment gets it right on purpose.
          return (await relations.groupOfSession(proposedId)) === grantId;
        default:
          return false;
      }
    }

    case "COURSE": {
      switch (proposal.scopeType) {
        case "COURSE":
          return proposedId === grantId;
        case "SESSION": {
          const sessions = await relations.sessionsOfCourse(grantId);
          return sessions.includes(proposedId);
        }
        default:
          return false;
      }
    }

    case "SESSION":
      return proposal.scopeType === "SESSION" && proposedId === grantId;

    default:
      return false;
  }
}

/** Does this one grant cover a bare person? Used only by the `SELF` case. */
async function grantCoversPerson(
  grant: GranterGrant,
  personId: string,
): Promise<boolean> {
  if (grant.scopeType === "UNIT") {
    return (await scopeRelations().unitOfPerson(personId)) === grant.scopeId;
  }
  return false;
}

/**
 * Window confinement (invariant 3, as repaired by D-170).
 *
 * The original was **vacuous for exactly the granters who matter**: D-144
 * permits a null `validUntil` for instructor and administrator grants — that
 * is, for every `ORGANIZATION`-scoped administrator and every standing Planner,
 * the principals who actually issue examiner grants. A null window contains
 * every window, so the check passed for `2099-12-31`. F-139.
 *
 * The repair is a null granter window read as **that granter's maximum
 * grantable window for the scope being granted**, not as infinity. That maximum
 * is D-170's ceiling, and `assertWithinCeiling` has already enforced it against
 * the proposal — so by the time execution reaches here, a null granter window is
 * genuinely permissive and the ceiling is what bounds the value.
 */
function windowContained(
  grant: GranterGrant,
  proposal: GrantProposal,
): boolean {
  if (proposal.validFrom < grant.validFrom) return false;
  if (grant.validUntil === null) return true;
  // A standing proposal cannot sit inside a bounded granter window: a
  // SESSION-scoped assessor cannot issue a grant that outlives their own.
  if (proposal.validUntil === null) return false;
  return proposal.validUntil <= grant.validUntil;
}
