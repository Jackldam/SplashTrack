/**
 * `Assessment` as an append-only log, and the vocabulary that goes with it.
 *
 * "IS THIS THE CURRENT AFTEST?" IS A QUESTION ABOUT THE ROWS, on the exact
 * `effectiveAttendanceByStudent` derivation (D-061/D-062, applied a third
 * time): a superseded row is out of the running no matter how recent it is,
 * and among the rest the latest wins — grouped by `criterionSetId` here
 * rather than by session or criterion, because D-081 pins one assessment to
 * one immutable version and a correction stays inside that version (the
 * service's own cross-row check, {@link AssessmentRefusal.SUPERSEDED_ASSESSMENT_MISMATCH}).
 *
 * Pure functions over rows. No I/O, and no clock of their own.
 */

import type { AssessmentOutcome } from "@/lib/database";

/** The two outcomes D-080 computes. Never typed by an assessor. */
export const ASSESSMENT_OUTCOMES = [
  "PASS",
  "FAIL",
] as const satisfies readonly AssessmentOutcome[];

export type AssessmentOutcomeValue = (typeof ASSESSMENT_OUTCOMES)[number];

/** One recorded assessment, as much of it as the derivation needs. */
export interface AssessmentEntry {
  readonly id: string;
  readonly criterionSetId: string;
  readonly outcome: AssessmentOutcomeValue;
  readonly assessedAt: Date;
  readonly supersedesAssessmentId: string | null;
}

/** The current answer per criterion set, and the row that gives it. */
export interface EffectiveAssessment {
  readonly assessmentId: string;
  readonly outcome: AssessmentOutcomeValue;
  readonly assessedAt: Date;
}

/**
 * The EFFECTIVE assessment per criterion set, for one student's rows — the
 * latest assessment that no other assessment supersedes. Ties resolve by
 * INSERTION order (callers pass rows by `createdAt`), the
 * `effectiveAttendanceByStudent` convention unchanged.
 */
export function effectiveAssessmentsByCriterionSet(
  entries: readonly AssessmentEntry[],
): Map<string, EffectiveAssessment> {
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.supersedesAssessmentId !== null) {
      superseded.add(entry.supersedesAssessmentId);
    }
  }

  const latest = new Map<string, EffectiveAssessment>();
  for (const entry of entries) {
    if (superseded.has(entry.id)) continue;
    const current = latest.get(entry.criterionSetId);
    if (!current || entry.assessedAt >= current.assessedAt) {
      latest.set(entry.criterionSetId, {
        assessmentId: entry.id,
        outcome: entry.outcome,
        assessedAt: entry.assessedAt,
      });
    }
  }
  return latest;
}

/** Why an assessment write was refused — a sentence, not a constraint error. */
export type AssessmentRefusal =
  | "SESSION_NOT_FOUND"
  | "SESSION_CANCELLED"
  | "NOT_ON_ROSTER"
  | "CRITERION_SET_NOT_ACTIVE"
  | "UNKNOWN_CRITERION"
  | "UNKNOWN_GRADE_VALUE"
  | "DUPLICATE_CRITERION_RESULT"
  | "DUPLICATE_CRITERION_WAIVER"
  | "DOUBLY_DISPOSED_CRITERION"
  | "INCOMPLETE"
  | "TOO_MANY_ENTRIES"
  | "NOT_INDEPENDENT"
  | "SUPERSEDED_ASSESSMENT_MISMATCH";

export class AssessmentError extends Error {
  constructor(public readonly reason: AssessmentRefusal) {
    super(ASSESSMENT_MESSAGES[reason]);
    this.name = "AssessmentError";
  }
}

const ASSESSMENT_MESSAGES: Record<AssessmentRefusal, string> = {
  SESSION_NOT_FOUND: "Deze les bestaat niet.",
  SESSION_CANCELLED:
    "Deze les is afgelast; er is geen aftest afgenomen. Leg de aftest vast " +
    "op de les die wél doorging.",
  NOT_ON_ROSTER:
    "Deze leerling staat niet op de deelnemerslijst van deze les. Voeg het " +
    "kind eerst toe via 'Gast toevoegen' op het lesscherm en leg daarna de " +
    "aftest vast.",
  CRITERION_SET_NOT_ACTIVE:
    "Deze eisenset is niet actief. Een aftest wordt alleen vastgelegd tegen " +
    "de geldende versie van een eisenset.",
  UNKNOWN_CRITERION: "Een van de eisen hoort niet bij de gekozen eisenset.",
  UNKNOWN_GRADE_VALUE:
    "Een van de opgegeven cijfers bestaat niet op de beoordelingsschaal.",
  DUPLICATE_CRITERION_RESULT:
    "Voor één eis is meer dan één cijfer opgegeven. Elke eis krijgt precies " +
    "één beoordeling per aftest.",
  DUPLICATE_CRITERION_WAIVER:
    "Voor één eis is meer dan één vrijstelling opgegeven.",
  DOUBLY_DISPOSED_CRITERION:
    "Een eis heeft zowel een cijfer als een vrijstelling gekregen. Kies één " +
    "van de twee.",
  INCOMPLETE:
    "Niet elke eis is beoordeeld of vrijgesteld. Een uitslag wordt nooit " +
    "berekend over onbeoordeelde eisen — vul de ontbrekende eisen aan.",
  TOO_MANY_ENTRIES: "Er zijn te veel beoordelingen in één keer aangeboden.",
  NOT_INDEPENDENT:
    "De beoordelaar is de eigen instructeur van deze leerling. Een aftest " +
    "die meetelt voor het examen wordt afgenomen door een andere, bevoegde " +
    "instructeur (het vier-ogen-principe). Alleen met de bijbehorende " +
    "uitzonderingsbevoegdheid kan dit toch worden vastgelegd.",
  SUPERSEDED_ASSESSMENT_MISMATCH:
    "De te corrigeren aftest hoort niet bij deze leerling en deze eisenset. " +
    "Een correctie wijst altijd naar de aftest die zij vervangt.",
};
