/**
 * Reads over `AttendanceEvent` — the append-only register
 * (`01-domain-model.md` §3.4).
 *
 * WRITES ARE NOT HERE. The two writes this module has
 * (`registerSessionAttendance`, `amendAttendance`) live in the service inside
 * the transaction that also records their audit event — the
 * `recordSkillProgress` shape — because the write and its audit row must be
 * one transaction (D-126) and a repository function holding half of that
 * would invite calling it without the other half.
 *
 * READ-SIDE NARROWING, VIA `attendanceFilterForReach`: every student-history
 * read is reached only after the service has guarded `attendance.read` on
 * `{ student }`, and is then narrowed to what the caller's `Reach` covers per
 * row — the `findSkillProgressForStudent` shape, unchanged.
 *
 * SERVER-ONLY.
 */
import { type Reach } from "@/lib/authorization";
import { prisma } from "@/lib/database";

import type { AttendanceStateValue } from "../domain/attendance-event";
import { attendanceFilterForReach } from "./attendance-reach-filter";

/** One row of a pupil's attendance history, as the person screen renders it. */
export interface StudentAttendanceEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly groupName: string;
  readonly occursOn: Date;
  readonly state: AttendanceStateValue;
  readonly recordedAt: Date;
  readonly note: string | null;
  /** True when a later event superseded this one — rendered struck-through. */
  readonly superseded: boolean;
}

/**
 * A pupil's attendance history, most recent lesson first, narrowed to what
 * `reach` covers. Superseded events are RETURNED and marked, not hidden: the
 * log is evidence, and "the instructor first wrote absent and corrected it at
 * 18:20" is exactly what D-061 keeps.
 */
export async function findAttendanceForStudent(
  studentProfileId: string,
  reach: Reach,
): Promise<StudentAttendanceEntry[]> {
  const filter = attendanceFilterForReach(reach);
  if (filter.kind === "DENIED") return [];

  const rows = await prisma.attendanceEvent.findMany({
    where:
      filter.kind === "WHERE"
        ? { studentProfileId, ...filter.where }
        : { studentProfileId },
    orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      sessionId: true,
      state: true,
      recordedAt: true,
      note: true,
      session: {
        select: { occursOn: true, group: { select: { name: true } } },
      },
      supersededBy: { select: { id: true }, take: 1 },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    groupName: row.session.group.name,
    occursOn: row.session.occursOn,
    state: row.state,
    recordedAt: row.recordedAt,
    note: row.note,
    superseded: row.supersededBy.length > 0,
  }));
}

/** One event of a session's register, in true write order. */
export interface SessionAttendanceEvent {
  readonly id: string;
  readonly studentProfileId: string;
  readonly state: AttendanceStateValue;
  readonly recordedAt: Date;
  readonly supersedesEventId: string | null;
  readonly note: string | null;
}

/**
 * Every event registered against one session, in write order — the rows the
 * service derives the effective register from (`effectiveAttendanceByStudent`)
 * and the correction form points its `supersedesEventId` at.
 *
 * No reach filter: the service guards `attendance.read` on `{ session }`, and
 * a reach that covers the session covers its register (§2.2's `GROUP` row
 * names sessions; `SESSION` covers "that one session's roster only" — this IS
 * that roster's register).
 */
export async function findSessionAttendance(
  sessionId: string,
): Promise<SessionAttendanceEvent[]> {
  return prisma.attendanceEvent.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      studentProfileId: true,
      state: true,
      recordedAt: true,
      supersedesEventId: true,
      note: true,
    },
  });
}
