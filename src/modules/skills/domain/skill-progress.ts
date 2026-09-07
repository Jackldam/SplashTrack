/**
 * `SkillProgress` as an append-only log, and the vocabulary that goes with it.
 *
 * "IS THIS CRITERION ACHIEVED?" IS A QUESTION ABOUT THE ROWS. On the
 * `01-domain-model.md` §3.3 / D-005 pattern every other event log in this
 * schema follows (attendance, exam results, assessments): a correction is a
 * NEW row, never an UPDATE of an old one. `REVOKED` is written the same way
 * ACHIEVED is — it is a state, not a delete.
 *
 * Pure functions over rows. No I/O, and no clock of their own.
 */

import type { SkillProgressState } from "@/lib/database";

/**
 * The four states `01-domain-model.md` §3.3 names, in the order a form offers
 * them. Typed against the generated Prisma enum rather than restating it, so a
 * member added to the schema and not to this list fails to compile.
 */
export const SKILL_PROGRESS_STATES = [
  "INTRODUCED",
  "PRACTISING",
  "ACHIEVED",
  "REVOKED",
] as const satisfies readonly SkillProgressState[];

export type SkillProgressStateValue = (typeof SKILL_PROGRESS_STATES)[number];

/**
 * Writing a `REVOKED` row needs `skills.revoke`; every other state needs
 * `skills.assess` — the `attendance.record`/`attendance.amend` split, applied
 * to the one permission pair the catalogue actually has for this module
 * (§2.5: `skills.assess`, `skills.revoke`).
 */
export function permissionFor(
  state: SkillProgressStateValue,
): "skills.assess" | "skills.revoke" {
  return state === "REVOKED" ? "skills.revoke" : "skills.assess";
}

/** One recorded observation, as much of it as a derivation needs. */
export interface ProgressEntry {
  readonly criterionId: string;
  readonly assessedAt: Date;
  readonly state: SkillProgressStateValue;
}

/**
 * The EFFECTIVE state per criterion: the latest row, per criterion, that
 * nothing else supersedes by being later — the same derivation pattern
 * attendance and exam results use (D-061, D-062), applied here because
 * `SkillProgress` carries no `supersedesId` of its own (§3.3 gives it none;
 * ordering by `assessedAt` is the design's own resolution rule, not one this
 * module invented).
 *
 * Ties (two rows for one criterion at the same `assessedAt`) resolve to
 * whichever this function is handed last for that instant — callers pass rows
 * in a stable order (by `createdAt`, the true write order) so a tie is
 * resolved by INSERTION order rather than arbitrarily.
 */
export function effectiveStateByCriterion(
  entries: readonly ProgressEntry[],
): Map<string, SkillProgressStateValue> {
  const latest = new Map<
    string,
    { at: Date; state: SkillProgressStateValue }
  >();
  for (const entry of entries) {
    const current = latest.get(entry.criterionId);
    if (!current || entry.assessedAt >= current.at) {
      latest.set(entry.criterionId, {
        at: entry.assessedAt,
        state: entry.state,
      });
    }
  }
  return new Map(
    [...latest.entries()].map(([criterionId, { state }]) => [
      criterionId,
      state,
    ]),
  );
}

/** Why a progress observation could not be recorded. */
export type SkillProgressRefusal =
  "NOT_A_GROUP_MEMBER" | "CRITERION_NOT_ACTIVE";

export class SkillProgressError extends Error {
  constructor(public readonly reason: SkillProgressRefusal) {
    super(SKILL_PROGRESS_MESSAGES[reason]);
    this.name = "SkillProgressError";
  }
}

const SKILL_PROGRESS_MESSAGES: Record<SkillProgressRefusal, string> = {
  NOT_A_GROUP_MEMBER:
    "Deze leerling is geen actief lid van deze groep. Voortgang wordt " +
    "vastgelegd voor een leerling die er nu bij hoort.",
  CRITERION_NOT_ACTIVE:
    "Deze eis hoort bij een eisenset die niet actief is. Voortgang wordt " +
    "alleen vastgelegd tegen de geldende versie van een eisenset.",
};
