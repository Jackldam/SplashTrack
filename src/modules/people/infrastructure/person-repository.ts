/**
 * Reads over `Person` and everything this module owns.
 *
 * TWO RULES SHAPE EVERY FUNCTION HERE.
 *
 * 1. **A `Reach` is a required argument on every list** (D-031,
 *    `05-technical.md` §5). Not an optional filter, not a boolean, not a
 *    principal the repository resolves for itself — the opaque value
 *    `resolveReach` produced, translated by `personFilterForReach`. A repository
 *    that could be called without one is a repository that will be.
 *
 * 2. **The ciphertext of `PersonRelationship.evidence` never leaves this file in
 *    a general projection.** It is excluded from every `select` below, and the
 *    one function that returns it says so in its name, is separately guarded and
 *    separately audited. A field that is merely "usually not selected" ends up
 *    selected the first time somebody writes `include: { relationships: true }`.
 *
 * SERVER-ONLY.
 */
import { open, seal, type Sealed } from "@/lib/crypto";
import { prisma, type DatabaseClient } from "@/lib/database";

import {
  isCurrentlyAMember,
  type MembershipInterval,
} from "../domain/membership";
import {
  currentLifecycleState,
  type LifecycleEvent,
  type StudentLifecycleEventType,
  type StudentLifecycleState,
} from "../domain/student-lifecycle";
import {
  personFilterForReach,
  type PersonReachFilter,
} from "./person-reach-filter";
import type { Reach } from "@/lib/authorization";

/** The stable id of the encrypted column, from the registry. Never a literal. */
export const EVIDENCE_COLUMN_ID = "person_relationships.authority_evidence";

/** One row of the people list. Identity basics and two derived states. */
export interface PersonListItem {
  id: string;
  givenName: string;
  familyName: string;
  dateOfBirth: Date | null;
  memberNumber: string | null;
  studentNumber: string | null;
  /** Derived from the periods, never read from a column (D-059). */
  isMember: boolean;
  /** Null when this person is not a pupil at all. */
  lifecycleState: StudentLifecycleState | null;
}

export interface PersonRelationshipView {
  id: string;
  type: "GUARDIAN_OF" | "EMERGENCY_CONTACT";
  authority: boolean;
  validFrom: Date;
  validTo: Date | null;
  /** True when `evidence` holds a value — never the value itself. */
  hasEvidence: boolean;
  /** The other person in the relationship. */
  otherPerson: {
    id: string;
    givenName: string;
    familyName: string;
    dateOfBirth: Date | null;
  };
}

export interface PersonDetail {
  id: string;
  givenName: string;
  familyName: string;
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
  membership: {
    id: string;
    memberNumber: string;
    unitId: string | null;
    periods: {
      id: string;
      startedAt: Date;
      endedAt: Date | null;
      endReason: string | null;
    }[];
  } | null;
  studentProfile: {
    id: string;
    studentNumber: string;
    unitId: string | null;
    lifecycleEvents: {
      id: string;
      type: StudentLifecycleEventType;
      occurredAt: Date;
      reason: string | null;
    }[];
  } | null;
  /** Relationships in which this person is the SUBJECT — who answers for them. */
  guardians: PersonRelationshipView[];
  /** Relationships in which this person is the RELATIVE — who they answer for. */
  dependants: PersonRelationshipView[];
}

/** Thrown when a reach covers no `Person` at all — a denial, never an empty list. */
export class ReachCoversNoPersonError extends Error {
  constructor() {
    super(
      "This reach covers no Person record. Returning an empty list would be " +
        "indistinguishable from a club with no members; the caller converts " +
        "this into a denial (06-delivery.md §2.1, the list case).",
    );
    this.name = "ReachCoversNoPersonError";
  }
}

/**
 * The `where` a reach permits, or a throw. Exported so a caller that needs to
 * combine it with its own filter cannot accidentally skip the denial branch.
 */
export function requirePersonFilter(
  reach: Reach,
): Exclude<PersonReachFilter, { kind: "DENIED" }> {
  const filter = personFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoPersonError();
  return filter;
}

export interface ListPeopleOptions {
  /** Free-text name/number search. Optional; case-insensitive contains. */
  readonly query?: string;
  readonly take?: number;
}

/** Hard ceiling on one page, so a missing `take` cannot become a full export. */
const LIST_LIMIT = 200;

/**
 * The people list, narrowed by reach.
 *
 * `at` is passed rather than taken from the clock so the two derived states —
 * "is a member" and the lifecycle state — are computed against the same instant
 * as the authorization decision that permitted the read.
 */
export async function listPeople(
  reach: Reach,
  at: Date,
  options: ListPeopleOptions = {},
  client: DatabaseClient = prisma,
): Promise<PersonListItem[]> {
  const filter = requirePersonFilter(reach);
  const reachWhere = filter.kind === "ALL" ? {} : filter.where;

  const search = options.query?.trim();
  const searchWhere = search
    ? {
        OR: [
          { givenName: { contains: search, mode: "insensitive" as const } },
          { familyName: { contains: search, mode: "insensitive" as const } },
          {
            memberships: {
              some: {
                memberNumber: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            },
          },
          {
            studentProfile: {
              is: {
                studentNumber: {
                  contains: search,
                  mode: "insensitive" as const,
                },
              },
            },
          },
        ],
      }
    : {};

  const rows = await client.person.findMany({
    where: { AND: [reachWhere, searchWhere] },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    take: Math.min(options.take ?? LIST_LIMIT, LIST_LIMIT),
    select: {
      id: true,
      givenName: true,
      familyName: true,
      dateOfBirth: true,
      memberships: {
        select: {
          memberNumber: true,
          periods: { select: { startedAt: true, endedAt: true } },
        },
      },
      studentProfile: {
        select: {
          studentNumber: true,
          lifecycleEvents: {
            select: { type: true, occurredAt: true },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          },
        },
      },
    },
  });

  return rows.map((row) => {
    // `memberships` is a list only because the schema models the relation that
    // way; `personId` is unique, so there is at most one.
    const membership = row.memberships[0] ?? null;
    const periods: MembershipInterval[] = membership?.periods ?? [];
    const events: LifecycleEvent[] = row.studentProfile?.lifecycleEvents ?? [];
    return {
      id: row.id,
      givenName: row.givenName,
      familyName: row.familyName,
      dateOfBirth: row.dateOfBirth,
      memberNumber: membership?.memberNumber ?? null,
      studentNumber: row.studentProfile?.studentNumber ?? null,
      isMember: isCurrentlyAMember(periods, at),
      lifecycleState: row.studentProfile
        ? currentLifecycleState(events, at)
        : null,
    };
  });
}

const RELATIONSHIP_SELECT = {
  id: true,
  type: true,
  authority: true,
  validFrom: true,
  validTo: true,
  // The PRESENCE of evidence, never the ciphertext. See the file header.
  evidence: false,
} as const;

const OTHER_PERSON_SELECT = {
  id: true,
  givenName: true,
  familyName: true,
  dateOfBirth: true,
} as const;

/**
 * One person and everything this module holds about them.
 *
 * Returns `null` when the row does not exist. It performs NO authorization —
 * the caller has already established coverage of THIS person through
 * `requirePermission(..., { person: id })`, which is a per-resource check and
 * not a filter, so re-deriving a `where` here would be a second, divergent
 * coverage rule.
 */
export async function findPersonDetail(
  personId: string,
  client: DatabaseClient = prisma,
): Promise<PersonDetail | null> {
  const row = await client.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      dateOfBirth: true,
      email: true,
      phone: true,
      memberships: {
        select: {
          id: true,
          memberNumber: true,
          unitId: true,
          periods: {
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              endReason: true,
            },
            orderBy: [{ startedAt: "asc" }],
          },
        },
      },
      studentProfile: {
        select: {
          id: true,
          studentNumber: true,
          unitId: true,
          lifecycleEvents: {
            select: { id: true, type: true, occurredAt: true, reason: true },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          },
        },
      },
      relationshipsAsSubject: {
        select: {
          ...RELATIONSHIP_SELECT,
          fromPerson: { select: OTHER_PERSON_SELECT },
        },
        orderBy: [{ validFrom: "asc" }],
      },
      relationshipsAsRelative: {
        select: {
          ...RELATIONSHIP_SELECT,
          toPerson: { select: OTHER_PERSON_SELECT },
        },
        orderBy: [{ validFrom: "asc" }],
      },
    },
  });
  if (!row) return null;

  const membership = row.memberships[0] ?? null;

  return {
    id: row.id,
    givenName: row.givenName,
    familyName: row.familyName,
    dateOfBirth: row.dateOfBirth,
    email: row.email,
    phone: row.phone,
    membership: membership
      ? {
          id: membership.id,
          memberNumber: membership.memberNumber,
          unitId: membership.unitId,
          periods: membership.periods,
        }
      : null,
    studentProfile: row.studentProfile,
    guardians: row.relationshipsAsSubject.map((relationship) => ({
      id: relationship.id,
      type: relationship.type,
      authority: relationship.authority,
      validFrom: relationship.validFrom,
      validTo: relationship.validTo,
      hasEvidence: false,
      otherPerson: relationship.fromPerson,
    })),
    dependants: row.relationshipsAsRelative.map((relationship) => ({
      id: relationship.id,
      type: relationship.type,
      authority: relationship.authority,
      validFrom: relationship.validFrom,
      validTo: relationship.validTo,
      hasEvidence: false,
      otherPerson: relationship.toPerson,
    })),
  };
}

/**
 * Whether each of these relationships holds evidence — the boolean the person
 * page renders, computed WITHOUT selecting the ciphertext.
 *
 * A separate query rather than a column on the projection above, because
 * `select: { evidence: true }` in the main read is exactly the line a later
 * refactor keeps while dropping the `open()` call it was written for.
 */
export async function relationshipsWithEvidence(
  relationshipIds: readonly string[],
  client: DatabaseClient = prisma,
): Promise<ReadonlySet<string>> {
  if (relationshipIds.length === 0) return new Set();
  const rows = await client.personRelationship.findMany({
    where: { id: { in: [...relationshipIds] }, NOT: { evidence: null } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** The relationship an evidence read is about, without the evidence itself. */
export interface RelationshipSubject {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  type: "GUARDIAN_OF" | "EMERGENCY_CONTACT";
  authority: boolean;
  validFrom: Date;
  validTo: Date | null;
  subjectDateOfBirth: Date | null;
}

export async function findRelationship(
  relationshipId: string,
  client: DatabaseClient = prisma,
): Promise<RelationshipSubject | null> {
  const row = await client.personRelationship.findUnique({
    where: { id: relationshipId },
    select: {
      id: true,
      fromPersonId: true,
      toPersonId: true,
      type: true,
      authority: true,
      validFrom: true,
      validTo: true,
      toPerson: { select: { dateOfBirth: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    type: row.type,
    authority: row.authority,
    validFrom: row.validFrom,
    validTo: row.validTo,
    subjectDateOfBirth: row.toPerson.dateOfBirth,
  };
}

/**
 * Decrypts one relationship's authority evidence.
 *
 * NAMED FOR WHAT IT DOES. Every caller of this function is disclosing free text
 * about a family's legal arrangements, and the name is what makes that visible
 * in a diff. The caller is responsible for the guard and for the audit event —
 * both live in the application service, because this layer makes no
 * authorization decisions.
 *
 * `open()` THROWS rather than returning null on an unreadable value (D-166): a
 * protected value that cannot be decrypted is reported, never hidden behind a
 * blank field that reads as "no evidence recorded".
 *
 * The primary key is the relationship's own id, which is what the value was
 * sealed with and what stops one family's evidence authenticating against
 * another's row.
 */
export async function readRelationshipEvidence(
  relationshipId: string,
  client: DatabaseClient = prisma,
): Promise<string | null> {
  const row = await client.personRelationship.findUnique({
    where: { id: relationshipId },
    select: { id: true, evidence: true },
  });
  if (!row?.evidence) return null;
  return open(EVIDENCE_COLUMN_ID, row.id, row.evidence);
}

/**
 * The sealed form of an evidence value, for a write.
 *
 * Takes the row id, because the primary key is authenticated data — it is what
 * makes the ciphertext non-portable between rows (D-096) — so a caller must
 * know the id BEFORE sealing. Creating a relationship therefore generates its
 * id up front rather than letting the database assign one, which is the whole
 * reason `createGuardianRelationship` does that.
 */
export function sealEvidence(
  relationshipId: string,
  plaintext: string,
): Sealed<typeof EVIDENCE_COLUMN_ID> {
  return seal(EVIDENCE_COLUMN_ID, relationshipId, plaintext);
}
