/**
 * `AttendanceEvent` as an append-only log, and the vocabulary that goes with
 * it.
 *
 * "WAS THIS CHILD THERE?" IS A QUESTION ABOUT THE ROWS. D-061: the effective
 * status per pupil per lesson is *"the latest event for that student and
 * session that nothing supersedes"* — derived at read time, never a column.
 * Unlike `SkillProgress` (which §3.3 gives no supersede pointer, so recency
 * alone decides), this table carries `supersedesEventId`, and the derivation
 * uses BOTH facts: a superseded event is out of the running no matter how
 * recent it is, and among the rest the latest wins.
 *
 * Pure functions over rows. No I/O, and no clock of their own.
 */

import type { AttendanceState } from "@/lib/database";

/**
 * The four states `01-domain-model.md` §3.4 names, in the order a register
 * offers them. Typed against the generated Prisma enum rather than restating
 * it, so a member added to the schema and not to this list fails to compile.
 */
export const ATTENDANCE_STATES = [
  "PRESENT",
  "ABSENT",
  "EXCUSED",
  "LATE",
] as const satisfies readonly AttendanceState[];

export type AttendanceStateValue = (typeof ATTENDANCE_STATES)[number];

/** One recorded event, as much of it as the derivation needs. */
export interface AttendanceEntry {
  readonly id: string;
  readonly studentProfileId: string;
  readonly state: AttendanceStateValue;
  readonly recordedAt: Date;
  readonly supersedesEventId: string | null;
}

/** The current answer for one pupil at one lesson, and the row that gives it. */
export interface EffectiveAttendance {
  readonly eventId: string;
  readonly state: AttendanceStateValue;
  readonly recordedAt: Date;
}

/**
 * The EFFECTIVE state per pupil for ONE session's events — D-061's own
 * derivation: per pupil, the latest event that no other event supersedes.
 *
 * Ties (two surviving rows for one pupil at the same `recordedAt`) resolve to
 * whichever this function is handed last for that instant — callers pass rows
 * in a stable order (by `createdAt`, the true write order) so a tie resolves
 * by INSERTION order rather than arbitrarily, the
 * `effectiveStateByCriterion` convention unchanged.
 */
export function effectiveAttendanceByStudent(
  entries: readonly AttendanceEntry[],
): Map<string, EffectiveAttendance> {
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.supersedesEventId !== null)
      superseded.add(entry.supersedesEventId);
  }

  const latest = new Map<string, EffectiveAttendance>();
  for (const entry of entries) {
    if (superseded.has(entry.id)) continue;
    const current = latest.get(entry.studentProfileId);
    if (!current || entry.recordedAt >= current.recordedAt) {
      latest.set(entry.studentProfileId, {
        eventId: entry.id,
        state: entry.state,
        recordedAt: entry.recordedAt,
      });
    }
  }
  return latest;
}

/** Why an attendance write was refused — a sentence, not a constraint error. */
export type AttendanceRefusal =
  | "SESSION_NOT_FOUND"
  | "SESSION_CANCELLED"
  | "NOT_ON_ROSTER"
  | "NOTHING_TO_REGISTER"
  | "DUPLICATE_PUPIL"
  | "SUPERSEDED_EVENT_MISMATCH";

export class AttendanceError extends Error {
  constructor(public readonly reason: AttendanceRefusal) {
    super(ATTENDANCE_MESSAGES[reason]);
    this.name = "AttendanceError";
  }
}

const ATTENDANCE_MESSAGES: Record<AttendanceRefusal, string> = {
  SESSION_NOT_FOUND: "Deze les bestaat niet.",
  SESSION_CANCELLED:
    "Deze les is afgelast; er is niemand aanwezig geweest. Aanwezigheid " +
    "wordt vastgelegd op de les die wél doorging.",
  NOT_ON_ROSTER:
    "Deze leerling staat niet op de deelnemerslijst van deze les. Voeg het " +
    "kind eerst toe via 'Gast toevoegen' op het lesscherm — dat werkt voor " +
    "een inhaalles, een leerling uit een andere groep én een proefzwemmer — " +
    "en leg daarna de aanwezigheid vast.",
  NOTHING_TO_REGISTER:
    "Er is geen enkele aanwezigheid opgegeven; er valt niets vast te leggen.",
  DUPLICATE_PUPIL:
    "Dezelfde leerling staat twee keer in deze registratie. Eén les, één " +
    "leerling, één waarneming — een correctie is een aparte handeling.",
  SUPERSEDED_EVENT_MISMATCH:
    "De te corrigeren waarneming hoort niet bij deze les en deze leerling. " +
    "Een correctie wijst altijd naar de waarneming die zij vervangt.",
};
