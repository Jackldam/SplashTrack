/**
 * Reads over `ScheduledSession` and the facilities beside it. Every list takes a
 * `Reach` as a REQUIRED argument (D-031).
 *
 * SERVER-ONLY. Nothing here guards; the services above do.
 */
import type { Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import {
  resolveLaneSource,
  type SessionLaneSourceView,
} from "../application/lane-assignment-service";
import { sessionFilterForReach } from "./session-reach-filter";

/** One lane, as a schedule names it. */
export interface AssignedLane {
  readonly id: string;
  readonly name: string;
}

/**
 * A lesson's lanes AND where they came from, which travel together on purpose.
 *
 * A surface that got the lanes without the source would render an inherited
 * lesson and an overridden one identically — and *"which of these did somebody
 * change"* is the question a person opening a schedule is actually asking. The
 * two are one value so that no screen can take the first and forget the second.
 */
export interface LaneAssignment {
  readonly lanes: readonly AssignedLane[];
  readonly laneSource: SessionLaneSourceView;
}

/** The row shape both session reads select, so the resolution below is shared. */
interface LaneCarryingRow {
  laneSource: "OVERRIDE" | "PINNED" | null;
  lanes: { lane: { id: string; name: string; sequence: number } }[];
  recurrence: {
    lanes: { lane: { id: string; name: string; sequence: number } }[];
  } | null;
}

/** What both reads ask Prisma for. One definition, so the two cannot drift. */
const LANE_SELECTION = {
  laneSource: true,
  lanes: { select: { lane: { select: laneFields() } } },
  recurrence: {
    select: { lanes: { select: { lane: { select: laneFields() } } } },
  },
} as const;

function laneFields() {
  return { id: true, name: true, sequence: true } as const;
}

/**
 * THE INHERITANCE, READ. A lesson with no `laneSource` carries no lanes of its
 * own and answers with its recurrence's — which is why a generated lesson costs
 * nothing to store and follows a change to the season for free.
 *
 * Sorted by the lane's own `sequence` here rather than in the query, because
 * the rows arrive through two different relations and only one comparison
 * should decide the order a person reads them in.
 */
function laneAssignment(row: LaneCarryingRow): LaneAssignment {
  const source = resolveLaneSource(row.laneSource);
  const rows =
    source === "INHERITED" ? (row.recurrence?.lanes ?? []) : row.lanes;
  return {
    laneSource: source,
    lanes: rows
      .map((entry) => entry.lane)
      .sort(
        (left, right) =>
          left.sequence - right.sequence ||
          left.name.localeCompare(right.name, "nl"),
      )
      .map((lane) => ({ id: lane.id, name: lane.name })),
  };
}

/**
 * Thrown when a reach covers no session at all — so the caller reports a DENIAL
 * rather than an empty schedule. An instructor whose assignment ended and who
 * sees an empty week learns the application is broken; what happened is that
 * they are no longer the person who may read it.
 */
export class ReachCoversNoSessionError extends Error {
  constructor() {
    super("This principal's reach covers no scheduled session.");
    this.name = "ReachCoversNoSessionError";
  }
}

export interface ScheduledSessionListItem {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly poolName: string | null;
  readonly occursOn: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: "SCHEDULED" | "CANCELLED";
  readonly cancellationReason: string | null;
  /** Explicit roster rows — guests, in this pass. */
  readonly guestCount: number;
  /** The lanes, and whether they are the season's or this lesson's own. */
  readonly laneAssignment: LaneAssignment;
}

/**
 * A group's schedule between two instants.
 *
 * **CANCELLED LESSONS ARE INCLUDED**, and that is the point of the screen.
 * "There was a lesson on the 12th and it was called off" is a different fact
 * from "there was never a lesson on the 12th", and a schedule that hid the first
 * would answer the parent's question wrongly. The status travels with the row so
 * the surface can render it plainly rather than by omission.
 */
export async function listSessions(
  reach: Reach,
  at: Date,
  window: { from: Date; to: Date; groupId?: string },
): Promise<ScheduledSessionListItem[]> {
  const filter = sessionFilterForReach(reach, at);
  if (filter.kind === "DENIED") throw new ReachCoversNoSessionError();

  const rows = await prisma.scheduledSession.findMany({
    where: {
      ...(filter.kind === "WHERE" ? filter.where : {}),
      ...(window.groupId ? { groupId: window.groupId } : {}),
      startsAt: { gte: window.from, lte: window.to },
    },
    orderBy: [{ startsAt: "asc" }],
    select: {
      id: true,
      groupId: true,
      occursOn: true,
      startsAt: true,
      endsAt: true,
      status: true,
      cancellationReason: true,
      group: { select: { name: true } },
      pool: { select: { name: true } },
      _count: { select: { rosterEntries: true } },
      ...LANE_SELECTION,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    groupName: row.group.name,
    poolName: row.pool?.name ?? null,
    occursOn: row.occursOn,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    cancellationReason: row.cancellationReason,
    guestCount: row._count.rosterEntries,
    laneAssignment: laneAssignment(row),
  }));
}

export interface RosterMember {
  readonly studentProfileId: string;
  readonly studentNumber: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly source: "GROUP" | "GUEST";
  /** Why a guest is here. Null for a group member. */
  readonly reason: string | null;
}

export interface SessionDetail {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly poolName: string | null;
  readonly occursOn: Date;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: "SCHEDULED" | "CANCELLED";
  readonly cancelledAt: Date | null;
  readonly cancellationReason: string | null;
  readonly roster: readonly RosterMember[];
  /** The lanes, and whether they are the season's or this lesson's own. */
  readonly laneAssignment: LaneAssignment;
  /**
   * Every lane in THIS lesson's pool, in the pool's own order — what the
   * override form offers.
   *
   * It comes from the read that already knows the lesson's pool rather than
   * from `listPools`, so the choices a person is shown are exactly the lanes
   * `overrideSessionLanes` will accept. A form built from the club's whole lane
   * list would offer choices the service refuses, which is a refusal the person
   * did nothing to earn.
   */
  readonly poolLanes: readonly AssignedLane[];
}

/**
 * One lesson and its EFFECTIVE roster — §3.2's *"derived from the group plus any
 * explicitly added guests"*, computed rather than stored.
 *
 * The group half is resolved against the LESSON's own date, not against now: a
 * child who has since moved on was still there in March, and the instructor
 * reviewing that lesson is looking at who was in the water. That the answer is
 * stable is a property of `GroupMembership` being time-bounded and never
 * mutated — a move CLOSES a row and opens another, so a past date keeps its past
 * answer for ever.
 *
 * The two halves are merged with the EXPLICIT row winning, so a pupil who is
 * both in the group and carries an explicit entry appears once, labelled by what
 * the entry says. `SessionRosterEntry`'s unique index guarantees there is at
 * most one.
 */
export async function findSessionDetail(
  sessionId: string,
): Promise<SessionDetail | null> {
  const session = await prisma.scheduledSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      groupId: true,
      occursOn: true,
      startsAt: true,
      endsAt: true,
      status: true,
      cancelledAt: true,
      cancellationReason: true,
      group: { select: { name: true } },
      pool: {
        select: {
          name: true,
          lanes: {
            orderBy: [{ sequence: "asc" }, { name: "asc" }],
            select: { id: true, name: true },
          },
        },
      },
      ...LANE_SELECTION,
      rosterEntries: {
        select: {
          source: true,
          reason: true,
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
  if (!session) return null;

  const members = await prisma.groupMembership.findMany({
    where: {
      groupId: session.groupId,
      fromDate: { lte: session.occursOn },
      OR: [{ toDate: null }, { toDate: { gt: session.occursOn } }],
    },
    select: {
      studentProfile: {
        select: {
          id: true,
          studentNumber: true,
          person: { select: { givenName: true, familyName: true } },
        },
      },
    },
  });

  const roster = new Map<string, RosterMember>();
  for (const member of members) {
    roster.set(member.studentProfile.id, {
      studentProfileId: member.studentProfile.id,
      studentNumber: member.studentProfile.studentNumber,
      givenName: member.studentProfile.person.givenName,
      familyName: member.studentProfile.person.familyName,
      source: "GROUP",
      reason: null,
    });
  }
  // Explicit entries overwrite the derived one — a deliberate row is a
  // statement, and the label it carries is the true one.
  for (const entry of session.rosterEntries) {
    roster.set(entry.studentProfile.id, {
      studentProfileId: entry.studentProfile.id,
      studentNumber: entry.studentProfile.studentNumber,
      givenName: entry.studentProfile.person.givenName,
      familyName: entry.studentProfile.person.familyName,
      source: entry.source,
      reason: entry.reason,
    });
  }

  return {
    id: session.id,
    groupId: session.groupId,
    groupName: session.group.name,
    poolName: session.pool?.name ?? null,
    occursOn: session.occursOn,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    status: session.status,
    cancelledAt: session.cancelledAt,
    cancellationReason: session.cancellationReason,
    laneAssignment: laneAssignment(session),
    poolLanes: session.pool?.lanes ?? [],
    roster: [...roster.values()].sort((left, right) =>
      `${left.familyName} ${left.givenName}`.localeCompare(
        `${right.familyName} ${right.givenName}`,
        "nl",
      ),
    ),
  };
}

export interface PoolView {
  readonly id: string;
  readonly name: string;
  readonly lengthMetres: number | null;
  readonly active: boolean;
  readonly lanes: readonly { readonly id: string; readonly name: string }[];
}

/**
 * The club's pools and their lanes.
 *
 * UNGUARDED BY REACH, and guarded by PERMISSION at the service. D-175 is
 * explicit that a pool is a facility and *never* an authorization scope — "who
 * may see everything in the shallow pool" has no answer in the scope model, by
 * design, because a pool is a place and places do not hold permissions. There is
 * no personal data here to reach-filter: a pool is a name and a length.
 */
export async function listPools(): Promise<PoolView[]> {
  const rows = await prisma.pool.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      lengthMetres: true,
      active: true,
      lanes: {
        orderBy: [{ sequence: "asc" }, { name: "asc" }],
        select: { id: true, name: true },
      },
    },
  });
  return rows;
}
