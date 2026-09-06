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
  readonly fromGroupName: string | null;
  readonly toGroupName: string;
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
 * A pupil's WHOLE group history — every placement and every move, in both
 * directions.
 *
 * ORDERED BY DATE AND NOTHING ELSE. There is no filter that hides a `DOWN`, no
 * separate "corrections" list, and no flag the renderer could colour on: a move
 * down is ordinary history and reads in sequence with the rest (D-108). That is
 * asserted rather than assumed — see `groups-move-symmetry.test.ts`.
 */
export async function findStudentGroupHistory(
  studentProfileId: string,
): Promise<{
  memberships: GroupHistoryEntry[];
  moves: GroupMoveEntry[];
}> {
  const [memberships, moves] = await Promise.all([
    prisma.groupMembership.findMany({
      where: { studentProfileId },
      orderBy: [{ fromDate: "asc" }],
      select: {
        id: true,
        fromDate: true,
        toDate: true,
        group: { select: { id: true, name: true } },
      },
    }),
    prisma.groupMove.findMany({
      where: { studentProfileId },
      orderBy: [{ occurredAt: "asc" }],
      select: {
        id: true,
        direction: true,
        reason: true,
        occurredAt: true,
        fromGroup: { select: { name: true } },
        toGroup: { select: { name: true } },
        decidedBy: { select: { givenName: true, familyName: true } },
      },
    }),
  ]);

  return {
    memberships: memberships.map((row) => ({
      membershipId: row.id,
      groupId: row.group.id,
      groupName: row.group.name,
      fromDate: row.fromDate,
      toDate: row.toDate,
    })),
    moves: moves.map((row) => ({
      id: row.id,
      fromGroupName: row.fromGroup?.name ?? null,
      toGroupName: row.toGroup.name,
      direction: row.direction,
      reason: row.reason,
      occurredAt: row.occurredAt,
      decidedBy: row.decidedBy,
    })),
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
