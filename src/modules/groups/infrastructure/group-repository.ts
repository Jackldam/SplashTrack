/**
 * Reads over `Group` and its time-bounded relations. Every list takes a `Reach`
 * as a REQUIRED argument (D-031) — there is no overload without one.
 *
 * SERVER-ONLY. Nothing here guards; the services above do, and they are the only
 * callers. What this file guarantees is that a caller cannot ask a question
 * without having resolved the authority to ask it.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import { groupFilterForReach } from "./group-reach-filter";

/**
 * Thrown when a reach covers no `Group` at all — so the caller can report a
 * DENIAL rather than an empty list.
 *
 * `06-delivery.md` §2.1 makes the list case the one that must never be dropped:
 * an instructor whose assignment ended and who sees *"geen groepen"* learns that
 * the application is broken. What actually happened is that they are no longer
 * the person who may read it, and only a refusal says so.
 */
export class ReachCoversNoGroupError extends Error {
  constructor() {
    super("This principal's reach covers no group.");
    this.name = "ReachCoversNoGroupError";
  }
}

export interface GroupListItem {
  readonly id: string;
  readonly name: string;
  readonly capacity: number | null;
  readonly active: boolean;
  /** Open `GroupMembership` rows right now — what capacity is measured against. */
  readonly occupied: number;
  /** Open `InstructorAssignment` rows, for the list's "who teaches it" column. */
  readonly instructors: readonly {
    readonly personId: string;
    readonly givenName: string;
    readonly familyName: string;
    readonly role: string | null;
  }[];
}

export interface GroupMemberView {
  readonly membershipId: string;
  readonly studentProfileId: string;
  readonly studentNumber: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly fromDate: Date;
  readonly toDate: Date | null;
}

export interface GroupDetail extends GroupListItem {
  readonly unitId: string | null;
  /** Current members — open intervals only. */
  readonly members: readonly GroupMemberView[];
}

/** The half-open activity rule, as a Prisma filter. Mirrors `isActiveAt`. */
function activeAt(at: Date) {
  return {
    fromDate: { lte: at },
    OR: [{ toDate: null }, { toDate: { gt: at } }],
  };
}

/** Groups this reach permits, with their current occupancy and instructors. */
export async function listGroups(
  reach: Reach,
  at: Date,
  options: { includeInactive?: boolean } = {},
): Promise<GroupListItem[]> {
  const filter = groupFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoGroupError();

  const rows = await prisma.group.findMany({
    where: {
      ...(filter.kind === "WHERE" ? filter.where : {}),
      ...(options.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      capacity: true,
      active: true,
      // COUNTED WITH THE SAME PREDICATE THE CEILING USES. Capacity counts open
      // placements (see `../domain/capacity.ts`), so the count that renders
      // beside it has to be the same one, or the screen reports a group as
      // having room that the service then refuses to place into.
      _count: { select: { memberships: { where: activeAt(at) } } },
      instructors: {
        where: activeAt(at),
        select: {
          role: true,
          person: { select: { id: true, givenName: true, familyName: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    active: row.active,
    occupied: row._count.memberships,
    instructors: row.instructors.map((assignment) => ({
      personId: assignment.person.id,
      givenName: assignment.person.givenName,
      familyName: assignment.person.familyName,
      role: assignment.role,
    })),
  }));
}

/**
 * One group with its current members.
 *
 * `null` only when the row genuinely does not exist. A group the caller may not
 * read produces a DENIAL at the service's `requirePermission`, before this is
 * called — the two answers are different and conflating them here would hide the
 * denial from the person who needs to understand it.
 */
export async function findGroupDetail(
  groupId: string,
  at: Date,
): Promise<GroupDetail | null> {
  const row = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      capacity: true,
      active: true,
      unitId: true,
      _count: { select: { memberships: { where: activeAt(at) } } },
      instructors: {
        where: activeAt(at),
        select: {
          role: true,
          person: { select: { id: true, givenName: true, familyName: true } },
        },
      },
      memberships: {
        where: activeAt(at),
        select: {
          id: true,
          fromDate: true,
          toDate: true,
          studentProfile: {
            select: {
              id: true,
              studentNumber: true,
              person: { select: { givenName: true, familyName: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    active: row.active,
    unitId: row.unitId,
    occupied: row._count.memberships,
    instructors: row.instructors.map((assignment) => ({
      personId: assignment.person.id,
      givenName: assignment.person.givenName,
      familyName: assignment.person.familyName,
      role: assignment.role,
    })),
    members: row.memberships
      .map((membership) => ({
        membershipId: membership.id,
        studentProfileId: membership.studentProfile.id,
        studentNumber: membership.studentProfile.studentNumber,
        givenName: membership.studentProfile.person.givenName,
        familyName: membership.studentProfile.person.familyName,
        fromDate: membership.fromDate,
        toDate: membership.toDate,
      }))
      .sort((left, right) =>
        `${left.familyName} ${left.givenName}`.localeCompare(
          `${right.familyName} ${right.givenName}`,
          "nl",
        ),
      ),
  };
}

export interface GroupHistoryEntry {
  readonly membershipId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly fromDate: Date;
  readonly toDate: Date | null;
}

export interface GroupMoveEntry {
  readonly id: string;
  /**
   * Null for a FIRST placement — there was no group before this one — and also
   * null when the caller does not reach the group they came from, which
   * {@link GroupMoveEntry.fromGroupWithheld} is what distinguishes. Two very
   * different facts; a screen that rendered both as a blank would be telling one
   * of them wrongly.
   */
  readonly fromGroupName: string | null;
  /** True when a group name was WITHHELD rather than absent. */
  readonly fromGroupWithheld: boolean;
  readonly toGroupName: string | null;
  readonly toGroupWithheld: boolean;
  readonly direction: "UP" | "DOWN" | "LATERAL";
  readonly reason: string;
  readonly occurredAt: Date;
  /** Null once erasure has severed it — the decision stands, the name goes. */
  readonly decidedBy: {
    readonly givenName: string;
    readonly familyName: string;
  } | null;
}

/**
 * A pupil's group history, NARROWED TO WHAT THIS REACH COVERS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REACH ARGUMENT IS NOT OPTIONAL, AND WHY IT WAS ADDED
 *
 * The first version of this function took only a `studentProfileId` and returned
 * everything, on the strength of the service having guarded `{ student }`. That
 * guard is real — it establishes the caller reaches the PUPIL — and it is not
 * sufficient, which is exactly D-145 rule 2: *coverage is per **relation**, not
 * per entity*, and a `GROUP`-scoped instructor gets *"that group's progress and
 * attendance only"*.
 *
 * A `GROUP` grant DOES cover `{ student }` for a pupil in that group
 * (`coversResource`'s `GROUPS`/`student` branch), so the guard passed and the
 * instructor received every group the child had ever been in, by name, with
 * dates — including the club-swimming group they have no relationship with.
 * `groups-scope-escape.test.ts` caught it, which is the case
 * `06-delivery.md` §2.1 means when it requires the suite to assert on the
 * FIELDS returned rather than only on reachability. A green `coversResource` is
 * necessary and not sufficient.
 *
 * So the narrowing is here, in the query, against the same filter the group list
 * uses — one home for "which groups does this reach cover".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A WITHHELD GROUP IS SAID TO BE WITHHELD
 *
 * A move whose OTHER end is out of reach is still the pupil's history and still
 * belongs in the list: *"moved out of this group on 3 March, meer tijd nodig
 * voor de schoolslagbeenslag"* is the instructor's own record. What is withheld
 * is the other group's NAME, and the entry says so rather than rendering a blank
 * that reads as "there was no group".
 *
 * ORDERED BY DATE AND NOTHING ELSE. There is no filter that hides a `DOWN`, no
 * separate "corrections" list, and no flag the renderer could colour on: a move
 * down is ordinary history and reads in sequence with the rest (D-108). That is
 * asserted rather than assumed — see `groups-move-symmetry.test.ts`.
 */
export async function findStudentGroupHistory(
  studentProfileId: string,
  reach: Reach,
): Promise<{
  memberships: GroupHistoryEntry[];
  moves: GroupMoveEntry[];
}> {
  const filter = groupFilterForReach(reach);
  if (filter.kind === "DENIED") throw new ReachCoversNoGroupError();

  // NULL means "no narrowing", and it is kept distinct from an empty object on
  // purpose. `{ group: {} }` is NOT a no-op in Prisma — as a relation filter it
  // constrains rather than passes through, and using it for the `ALL` case
  // silently returned an empty history to an ORGANIZATION-scoped administrator.
  // The same reason `GroupReachFilter` has an `ALL` variant instead of an empty
  // `where`: "no filter" and "a filter that matches everything" are different.
  const scope = filter.kind === "WHERE" ? filter.where : null;

  const [memberships, moves] = await Promise.all([
    prisma.groupMembership.findMany({
      where: { studentProfileId, ...(scope ? { group: scope } : {}) },
      orderBy: [{ fromDate: "asc" }],
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        group: { select: { id: true, name: true } },
      },
    }),
    prisma.groupMove.findMany({
      // EITHER end. A move out of the caller's group is as much their record as
      // a move into it, and dropping the first would make a child appear to
      // vanish from the history with no explanation.
      where: {
        studentProfileId,
        ...(scope ? { OR: [{ toGroup: scope }, { fromGroup: scope }] } : {}),
      },
      orderBy: [{ occurredAt: "asc" }],
      select: {
        id: true,
        direction: true,
        reason: true,
        occurredAt: true,
        fromGroupId: true,
        toGroupId: true,
        fromGroup: { select: { name: true } },
        toGroup: { select: { name: true } },
        decidedBy: { select: { givenName: true, familyName: true } },
      },
    }),
  ]);

  // Which of the groups named by those moves this reach actually covers. One
  // query rather than one per move, and it uses the same filter as everything
  // else so it cannot disagree with the list above.
  const named = new Set<string>();
  for (const move of moves) {
    named.add(move.toGroupId);
    if (move.fromGroupId) named.add(move.fromGroupId);
  }
  const reachable =
    scope === null
      ? named
      : new Set(
          named.size === 0
            ? []
            : (
                await prisma.group.findMany({
                  where: { AND: [{ id: { in: [...named] } }, scope] },
                  select: { id: true },
                })
              ).map((row) => row.id),
        );

  return {
    memberships: memberships.map((row) => ({
      membershipId: row.id,
      groupId: row.group.id,
      groupName: row.group.name,
      fromDate: row.fromDate,
      toDate: row.toDate,
    })),
    moves: moves.map((row) => {
      const fromReachable =
        row.fromGroupId !== null && reachable.has(row.fromGroupId);
      const toReachable = reachable.has(row.toGroupId);
      return {
        id: row.id,
        fromGroupName: fromReachable ? (row.fromGroup?.name ?? null) : null,
        // A first placement has no source group at all, so nothing is being
        // withheld — only an EXISTING group the caller cannot reach is.
        fromGroupWithheld: row.fromGroupId !== null && !fromReachable,
        toGroupName: toReachable ? row.toGroup.name : null,
        toGroupWithheld: !toReachable,
        direction: row.direction,
        reason: row.reason,
        occurredAt: row.occurredAt,
        decidedBy: row.decidedBy,
      };
    }),
  };
}

/**
 * The active members of a group at an instant — what the `sessions` module asks
 * for when it builds a roster.
 *
 * UNGUARDED BY DESIGN, and reached only through the module's published service,
 * which guards. It is in the repository rather than the service because it
 * returns ids and nothing else.
 */
export async function activeMemberIds(
  groupId: string,
  at: Date,
): Promise<string[]> {
  const rows = await prisma.groupMembership.findMany({
    where: { groupId, ...activeAt(at) },
    select: { studentProfileId: true },
  });
  return rows.map((row) => row.studentProfileId);
}

/** Whether a reach names any group at all, for a caller that only needs to know. */
export function reachNamesAGroup(reach: Reach): boolean {
  return reachVariant(reach).kind !== "NONE";
}
