/**
 * `Assessment` — the formal, four-eyes-gated *aftest*
 * (`15-assessment-and-fees.md` §2-5).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WRITES GUARD `{ session: scheduledSessionId }`, THE ATTENDANCE/D-179 SHAPE
 *
 * The whole reason D-068's `SESSION` participation reach exists is the
 * independent aftest assessor (§2.2's own coverage matrix: *"SESSION ... and,
 * for an exam or aftest session, the assessment/results being recorded
 * there"*). An assessor holds no `{ group }` reach over a child who is not
 * theirs — that is the point — so the guard is `{ session }`, on the exact
 * `attendance.record` precedent (phase 2.2 report §1.1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR-EYES GATE, AS FAR AS THIS MODULE CAN BUILD IT
 *
 * D-085 is a two-part formula: the assessor must be INDEPENDENT (not an
 * `InstructorAssignment` holder for the student's own group) AND hold a valid
 * `PersonQualification`. `PersonQualification` is an `exams`-phase table that
 * does not exist yet (out of THIS phase's scope, named beside `Award` and
 * `ExamResult` in the build brief) — so only independence is checked here,
 * at WRITE time, refusing a `PRE_EXAM` assessment recorded by the student's
 * own instructor unless the actor holds `assessment.independence.override`
 * (D-085's own words: *"overridable — deliberately"*). See the schema's
 * `Assessment` model comment and the phase 2.3 report for the reasoning and
 * for what is deliberately NOT enforced: refusing `ExamCandidate → CONFIRMED`
 * without a qualifying aftest is `exams`' write, against a table this phase
 * does not build (`01-domain-model.md` line ~130: *"The gate that exams
 * enforces before that (D-085) likewise reads assessment through its
 * published service, never its tables."*).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-086: EVERY CRITERION STARTS UNSET, AND AN OUTCOME IS NEVER COMPUTED OVER
 * ONE THAT STAYS THAT WAY
 *
 * `recordAssessment` refuses the whole write (`INCOMPLETE`) unless every
 * criterion in the pinned set carries EITHER a graded result OR a waiver —
 * never a default, never a partial outcome. This is the screen's slowness
 * made a server-side invariant, not only a UI convention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY THE CRITERION-RESULT REMARK IS PROTECTED FREE TEXT (D-087/D-148)
 *
 * DECIDED 2026-09-10 (Jack, phase 2.3 sign-off;
 * `docs/build/phase-2.3-assessment-report.md` §1.5): `Assessment.remark` (the
 * SITTING-level note) is ordinary, unprotected text — read and written
 * directly, no `seal()`/`open()`, no `students.notes.*` gate, no audit-on-read
 * — the exact `StudentLifecycleEvent.reason` treatment
 * (`@/modules/people/application/student-service.ts`). Only
 * `AssessmentCriterionResult.remark` (the per-criterion note) still carries
 * D-087/D-148's protection, because that is where D-087 says the remark
 * "actually" attaches: *"the remark is about the scissor kick, not about the
 * sitting."*
 *
 * Writing a non-empty CRITERION-RESULT remark additionally requires
 * `students.notes.write` — refusing the WHOLE write rather than silently
 * dropping the assessor's typed text, D-153's fail-loudly spirit applied to a
 * write instead of an export. Reading one additionally requires
 * `students.notes.read`; without it the caller still sees every grade, on
 * D-087's own words: *"an assessor without the notes permission sees grades
 * without the reasoning."* Every read that DOES disclose a criterion-result
 * remark is audited (`assessment.remark_revealed`), once per call, before the
 * value is decrypted — the `revealRelationshipEvidence` pattern
 * (`@/modules/people`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDS ARE PRE-GENERATED, NOT LEFT TO `@default(cuid(2))`
 *
 * `AssessmentCriterionResult.remark` is encrypted under an envelope whose AAD
 * binds the ROW'S OWN PRIMARY KEY (D-096) — so the id must be known BEFORE the
 * row is written, not after. Every other encrypted column in this schema
 * (`PersonRelationship.evidence`) belongs to an ordinarily-mutable table and
 * could create-then-update; `Assessment`/`AssessmentCriterionResult` are
 * append-only (the runtime role holds no UPDATE —
 * `assessmentGrantStatements`) so that escape does not exist here.
 * `randomUUID()` supplies the id; Prisma uses exactly what is given and never
 * overwrites a supplied `id`. `Assessment`'s own id is still pre-generated
 * (its `AssessmentCriterionResult` and `CriterionWaiver` children need it to
 * write in the same transaction), even though `remark` itself no longer needs
 * it for an AAD.
 *
 * ONE TRANSACTION, ONE AUDIT EVENT, P-02 IDEMPOTENT via `clientEventId` — the
 * `registerSessionAttendance` shape, applied to one sitting instead of one
 * roster.
 *
 * SERVER-ONLY.
 */
import { randomUUID } from "node:crypto";

import {
  PermissionDeniedError,
  requirePermission,
  type Principal,
} from "@/lib/authorization";
import { open, seal } from "@/lib/crypto";
import { prisma } from "@/lib/database";
import { optionalText, requiredDate, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";
import { awardTypeOfCourseLevel } from "@/modules/courses";
import {
  courseLevelOfGroup,
  isActiveInstructorOfStudent,
} from "@/modules/groups";
import {
  activeCriterionSetOfAwardType,
  criterionSetDetailForAssessment,
  gradeValuesByIds,
  type CriterionSetDetail,
} from "@/modules/skills";
import { findSessionRegisterFacts } from "@/modules/sessions";

import {
  AssessmentError,
  effectiveAssessmentsByCriterionSet,
  type AssessmentEntry,
  type AssessmentOutcomeValue,
  type EffectiveAssessment,
} from "../domain/assessment";
import {
  computeOutcome,
  doublyDisposedCriterionIds,
  unsettledCriterionIds,
} from "../domain/pass-rule";
import {
  findAssessmentsForStudent,
  findAssessmentsForStudentAndCriterionSet,
  type AssessmentCriterionResultView,
  type AssessmentView,
} from "../infrastructure/assessment-repository";
import { RESULTS_MAX_ENTRIES, TEXT_MAX } from "./input";

export { AssessmentError };
export type { AssessmentOutcomeValue, EffectiveAssessment };

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface RecordAssessmentResultInput {
  criterionId: unknown;
  gradeValueId: unknown;
  remark?: unknown;
}

export interface RecordAssessmentWaiverInput {
  criterionId: unknown;
  reason: unknown;
}

export interface RecordAssessmentInput {
  studentProfileId: unknown;
  criterionSetId: unknown;
  assessedAt?: unknown;
  remark?: unknown;
  clientEventId: unknown;
  supersedesAssessmentId?: unknown;
  results: readonly RecordAssessmentResultInput[];
  waivers?: readonly RecordAssessmentWaiverInput[];
}

interface ValidatedResult {
  readonly criterionId: string;
  readonly gradeValueId: string;
  readonly remark: string | null;
}

interface ValidatedWaiver {
  readonly criterionId: string;
  readonly reason: string;
}

function validateResults(
  results: readonly RecordAssessmentResultInput[],
): ValidatedResult[] {
  return results.map((r, i) => ({
    criterionId: requiredText(
      `results[${i}].criterionId`,
      r.criterionId,
      TEXT_MAX.id,
    ),
    gradeValueId: requiredText(
      `results[${i}].gradeValueId`,
      r.gradeValueId,
      TEXT_MAX.id,
    ),
    remark: optionalText(`results[${i}].remark`, r.remark, TEXT_MAX.remark),
  }));
}

function validateWaivers(
  waivers: readonly RecordAssessmentWaiverInput[],
): ValidatedWaiver[] {
  return waivers.map((w, i) => ({
    criterionId: requiredText(
      `waivers[${i}].criterionId`,
      w.criterionId,
      TEXT_MAX.id,
    ),
    reason: requiredText(
      `waivers[${i}].reason`,
      w.reason,
      TEXT_MAX.waiverReason,
    ),
  }));
}

function firstDuplicate(ids: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * Records one aftest sitting — the criterion set's criteria, every result
 * and waiver, the computed outcome, in one transaction. See the file comment
 * for the four-eyes/D-086/D-087 rules this enforces.
 *
 * A CORRECTION is the same call with `supersedesAssessmentId` set: there is
 * no separate "amend" verb (unlike attendance/skills), because correcting an
 * aftest is not a single-field edit — it is a full re-sitting, the same
 * shape as an original one.
 */
export async function recordAssessment(
  actor: ActorContext,
  scheduledSessionId: string,
  input: RecordAssessmentInput,
): Promise<{ id: string; outcome: AssessmentOutcomeValue }> {
  const at = instant(actor);

  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const criterionSetId = requiredText(
    "criterionSetId",
    input.criterionSetId,
    TEXT_MAX.id,
  );
  const assessedAt =
    input.assessedAt === undefined ||
    input.assessedAt === null ||
    input.assessedAt === ""
      ? at
      : requiredDate("assessedAt", input.assessedAt);
  const clientEventId = requiredText(
    "clientEventId",
    input.clientEventId,
    TEXT_MAX.id,
  );
  const remark = optionalText("remark", input.remark, TEXT_MAX.remark);
  const supersedesAssessmentId =
    input.supersedesAssessmentId === undefined ||
    input.supersedesAssessmentId === null ||
    input.supersedesAssessmentId === ""
      ? null
      : requiredText(
          "supersedesAssessmentId",
          input.supersedesAssessmentId,
          TEXT_MAX.id,
        );

  const results = validateResults(input.results);
  const waivers = validateWaivers(input.waivers ?? []);

  if (results.length + waivers.length > RESULTS_MAX_ENTRIES) {
    throw new AssessmentError("TOO_MANY_ENTRIES");
  }
  const duplicateResult = firstDuplicate(results.map((r) => r.criterionId));
  if (duplicateResult !== null) {
    throw new AssessmentError("DUPLICATE_CRITERION_RESULT");
  }
  const duplicateWaiver = firstDuplicate(waivers.map((w) => w.criterionId));
  if (duplicateWaiver !== null) {
    throw new AssessmentError("DUPLICATE_CRITERION_WAIVER");
  }
  if (doublyDisposedCriterionIds({ results, waivers }).length > 0) {
    throw new AssessmentError("DOUBLY_DISPOSED_CRITERION");
  }

  await requirePermission(
    actor.principal,
    "assessment.record",
    { session: scheduledSessionId },
    { at },
  );

  const session = await findSessionRegisterFacts(scheduledSessionId);
  if (session === null) throw new AssessmentError("SESSION_NOT_FOUND");
  if (session.status === "CANCELLED") {
    throw new AssessmentError("SESSION_CANCELLED");
  }
  if (!session.rosterStudentProfileIds.includes(studentProfileId)) {
    throw new AssessmentError("NOT_ON_ROSTER");
  }

  const set = await criterionSetDetailForAssessment(criterionSetId);
  if (
    set === null ||
    set.status !== "ACTIVE" ||
    set.passFloorGradeId === null
  ) {
    throw new AssessmentError("CRITERION_SET_NOT_ACTIVE");
  }
  const passFloorGradeId = set.passFloorGradeId;

  const validCriterionIds = new Set(set.criteria.map((c) => c.id));
  for (const r of results) {
    if (!validCriterionIds.has(r.criterionId)) {
      throw new AssessmentError("UNKNOWN_CRITERION");
    }
  }
  for (const w of waivers) {
    if (!validCriterionIds.has(w.criterionId)) {
      throw new AssessmentError("UNKNOWN_CRITERION");
    }
  }

  const unsettled = unsettledCriterionIds({
    criteria: set.criteria.map((c) => ({
      criterionId: c.id,
      minimumGradeId: c.minimumGradeId,
    })),
    results,
    waivers,
  });
  if (unsettled.length > 0) throw new AssessmentError("INCOMPLETE");

  const gradeValueIds = [
    ...new Set(
      [
        ...results.map((r) => r.gradeValueId),
        passFloorGradeId,
        ...set.criteria.map((c) => c.minimumGradeId),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const rankOf = await gradeValuesByIds(gradeValueIds);
  for (const r of results) {
    if (!rankOf.has(r.gradeValueId)) {
      throw new AssessmentError("UNKNOWN_GRADE_VALUE");
    }
  }

  // D-085's checkable half: independence. `assessorPersonId` is always the
  // caller — nobody records an aftest on someone else's behalf.
  const assessorPersonId = actor.principal.personId;
  const isOwnInstructor = await isActiveInstructorOfStudent(
    assessorPersonId,
    studentProfileId,
    assessedAt,
  );
  if (isOwnInstructor) {
    try {
      await requirePermission(
        actor.principal,
        "assessment.independence.override",
        { session: scheduledSessionId },
        { at },
      );
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        throw new AssessmentError("NOT_INDEPENDENT");
      }
      throw error;
    }
  }

  // `Assessment.remark` (the sitting-level note) is unprotected — see the
  // file comment — so only a non-empty CRITERION-RESULT remark gates the
  // write on `students.notes.write`.
  const hasCriterionRemark = results.some((r) => r.remark !== null);
  if (hasCriterionRemark) {
    await requirePermission(
      actor.principal,
      "students.notes.write",
      { student: studentProfileId },
      { at },
    );
  }

  const outcome = computeOutcome({
    criteria: set.criteria.map((c) => ({
      criterionId: c.id,
      minimumGradeId: c.minimumGradeId,
    })),
    results,
    waivers,
    passFloorGradeId,
    rankOf,
  });

  return prisma.$transaction(async (tx) => {
    // P-02: a replayed submission returns the row the first attempt wrote.
    const replay = await tx.assessment.findUnique({
      where: { clientEventId },
      select: { id: true, outcome: true },
    });
    if (replay !== null) return replay;

    // The cross-row half of D-061/D-062's supersession rule, re-checked
    // INSIDE the transaction that writes — the `amendAttendance` convention.
    if (supersedesAssessmentId !== null) {
      const superseded = await tx.assessment.findUnique({
        where: { id: supersedesAssessmentId },
        select: { studentProfileId: true, criterionSetId: true },
      });
      if (
        superseded === null ||
        superseded.studentProfileId !== studentProfileId ||
        superseded.criterionSetId !== criterionSetId
      ) {
        throw new AssessmentError("SUPERSEDED_ASSESSMENT_MISMATCH");
      }
    }

    const assessmentId = randomUUID();

    await tx.assessment.create({
      data: {
        id: assessmentId,
        kind: "PRE_EXAM",
        criterionSetId,
        studentProfileId,
        assessorPersonId,
        assessedAt,
        scheduledSessionId,
        outcome,
        outcomeComputedAt: at,
        supersedesAssessmentId,
        groupId: session.groupId,
        // Plain text, never sealed — see the file comment.
        remark,
        clientEventId,
      },
    });

    if (results.length > 0) {
      await tx.assessmentCriterionResult.createMany({
        data: results.map((r) => {
          const resultId = randomUUID();
          return {
            id: resultId,
            assessmentId,
            criterionId: r.criterionId,
            gradeValueId: r.gradeValueId,
            remark:
              r.remark === null
                ? null
                : seal(
                    "assessment.criterion_result_remark",
                    resultId,
                    r.remark,
                  ),
          };
        }),
      });
    }

    if (waivers.length > 0) {
      await tx.criterionWaiver.createMany({
        data: waivers.map((w) => ({
          assessmentId,
          criterionId: w.criterionId,
          reason: w.reason,
          grantedByPersonId: assessorPersonId,
        })),
      });
    }

    await recordAuditEvent(
      {
        eventType: "assessment.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: studentProfileId,
        requestId: actor.requestId ?? null,
        // IDS, COUNTS AND CLOSED-VOCABULARY TOKENS — never the remark VALUE.
        // `assessmentRemarkGiven` is safe to log even though the field itself
        // is unprotected plain text (D-153: an audit log is not the place to
        // duplicate a note either), while `criterionRemarkGiven` is the
        // D-148-adjacent restraint the `skills.progress.recorded`/
        // `attendance.registered` precedent already applies.
        changedFields: {
          assessmentId,
          criterionSetId,
          outcome,
          resultCount: results.length,
          waiverCount: waivers.length,
          supersedesAssessmentId,
          independentAssessor: !isOwnInstructor,
          assessmentRemarkGiven: remark !== null,
          criterionRemarkGiven: hasCriterionRemark,
        },
      },
      tx,
    );

    return { id: assessmentId, outcome };
  });
}

/**
 * One assessment with its criterion-result remarks decrypted — the shape
 * {@link revealRemarks} returns. `remark` (the sitting-level note) is ALREADY
 * plain on {@link AssessmentView}; only `results[].remark` needed opening.
 */
export interface RevealedAssessment extends Omit<AssessmentView, "results"> {
  readonly results: readonly (Omit<
    AssessmentCriterionResultView,
    "remarkSealed"
  > & {
    readonly remark: string | null;
  })[];
}

/**
 * Degrades every CRITERION-RESULT remark to `null` (grades and the
 * sitting-level `remark` survive either way), or — when the caller holds
 * `students.notes.read` — decrypts every one and audits the disclosure ONCE
 * for the whole call, before any value is opened (the
 * `revealRelationshipEvidence` "no access without a record" pattern,
 * `@/modules/people`). D-087: *"an assessor without the notes permission
 * sees grades without the reasoning."* `Assessment.remark` is unprotected —
 * see the file comment — so it is never touched here.
 */
async function revealRemarks(
  actor: ActorContext,
  studentProfileId: string,
  assessments: readonly AssessmentView[],
): Promise<RevealedAssessment[]> {
  const at = instant(actor);
  let canReadNotes = true;
  try {
    await requirePermission(
      actor.principal,
      "students.notes.read",
      { student: studentProfileId },
      { at },
    );
  } catch (error) {
    if (!(error instanceof PermissionDeniedError)) throw error;
    canReadNotes = false;
  }

  if (!canReadNotes) {
    return assessments.map((a) => ({
      ...a,
      results: a.results.map((r) => ({ ...r, remark: null })),
    }));
  }

  const sealedCount = assessments.reduce(
    (sum, a) => sum + a.results.filter((r) => r.remarkSealed !== null).length,
    0,
  );

  if (sealedCount > 0) {
    await recordAuditEvent({
      eventType: "assessment.remark_revealed",
      outcome: "SUCCESS",
      actorPersonId: actor.principal.personId,
      actorAuthMethod: "session",
      targetType: "student_profile",
      targetId: studentProfileId,
      requestId: actor.requestId ?? null,
      changedFields: {
        assessmentCount: assessments.length,
        remarksRevealed: sealedCount,
      },
      reason:
        "Assessment criterion-result remarks disclosed to a signed-in principal holding students.notes.read.",
    });
  }

  return assessments.map((a) => ({
    ...a,
    results: a.results.map((r) => ({
      ...r,
      remark:
        r.remarkSealed === null
          ? null
          : open("assessment.criterion_result_remark", r.id, r.remarkSealed),
    })),
  }));
}

/**
 * A pupil's aftest history, most recent sitting first, narrowed to what the
 * caller's `Reach` covers (only `GROUP` narrows — see
 * `assessment-reach-filter.ts`) and with CRITERION-RESULT remarks gated
 * behind `students.notes.read` independently of `assessment.read`. The
 * sitting-level `remark` is unprotected and always included — see the file
 * comment.
 */
export async function getAssessmentsForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<RevealedAssessment[]> {
  const at = instant(actor);
  const reach = await requirePermission(
    actor.principal,
    "assessment.read",
    { student: studentProfileId },
    { at },
  );
  const assessments = await findAssessmentsForStudent(studentProfileId, reach);
  return revealRemarks(actor, studentProfileId, assessments);
}

/**
 * The EFFECTIVE aftest per criterion set for a pupil — the latest sitting
 * nothing supersedes, per {@link effectiveAssessmentsByCriterionSet}. Reads
 * through {@link getAssessmentsForStudent}, so it carries the same reach
 * narrowing and remark gating.
 */
export async function getEffectiveAssessmentsForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<Map<string, EffectiveAssessment>> {
  const assessments = await getAssessmentsForStudent(actor, studentProfileId);
  const entries: AssessmentEntry[] = assessments.map((a) => ({
    id: a.id,
    criterionSetId: a.criterionSetId,
    outcome: a.outcome,
    assessedAt: a.assessedAt,
    supersedesAssessmentId: a.supersedesAssessmentId,
  }));
  return effectiveAssessmentsByCriterionSet(entries);
}

/**
 * D-085's formula, as far as this module can answer it — the published,
 * STRUCTURED fact the (unbuilt) `exams` module reads before letting an
 * `ExamCandidate` reach `CONFIRMED`, rather than its tables
 * (`01-domain-model.md` line ~130). A structured fact, deliberately not a
 * boolean: `exams` needs to know WHICH assessment qualifies (to point
 * `ExamResult.assessmentId` at it), WHO assessed it and whether independence
 * held — and needs to know, explicitly, that `qualificationVerified` is NOT
 * a real check this phase could perform, so it is never mistaken for one.
 *
 * UNGUARDED, on the `findSessionRegisterFacts`/`isActiveInstructorOfStudent`
 * precedent: the caller (`exams`, eventually) guards its own operation
 * before asking.
 */
export interface QualifyingAftestFacts {
  /** A non-superseded `PRE_EXAM` assessment against the ACTIVE set, PASS,
   * assessed by someone independent of the student's own group — the three
   * checkable clauses of D-085. */
  readonly hasQualifyingAssessment: boolean;
  readonly assessmentId: string | null;
  readonly assessorPersonId: string | null;
  readonly assessedAt: Date | null;
  /** `null` when there is no non-superseded PASS at all. */
  readonly independentOfStudentGroup: boolean | null;
  /** ALWAYS `false`. `PersonQualification` does not exist in this phase —
   * see the file comment. `exams` must add this check itself before treating
   * `hasQualifyingAssessment` as the full D-085 answer. */
  readonly qualificationVerified: false;
}

export async function qualifyingAftestFacts(
  studentProfileId: string,
  awardTypeId: string,
): Promise<QualifyingAftestFacts> {
  const activeSet = await activeCriterionSetOfAwardType(awardTypeId);
  const notQualifying: QualifyingAftestFacts = {
    hasQualifyingAssessment: false,
    assessmentId: null,
    assessorPersonId: null,
    assessedAt: null,
    independentOfStudentGroup: null,
    qualificationVerified: false,
  };
  if (activeSet === null) return notQualifying;

  const rows = await findAssessmentsForStudentAndCriterionSet(
    studentProfileId,
    activeSet.id,
  );
  const superseded = new Set(
    rows
      .map((r) => r.supersedesAssessmentId)
      .filter((id): id is string => id !== null),
  );
  const effective = rows.find(
    (r) => !superseded.has(r.id) && r.outcome === "PASS",
  );
  if (!effective) return notQualifying;

  const independent = effective.assessorPersonId
    ? !(await isActiveInstructorOfStudent(
        effective.assessorPersonId,
        studentProfileId,
        effective.assessedAt,
      ))
    : null;

  return {
    hasQualifyingAssessment: true,
    assessmentId: effective.id,
    assessorPersonId: effective.assessorPersonId,
    assessedAt: effective.assessedAt,
    independentOfStudentGroup: independent,
    qualificationVerified: false,
  };
}

/** Why a session has no criterion set to assess against — a sentence, not a blank screen. */
export type CriteriaForAftestReason =
  "NO_LEVEL" | "NO_AWARD_TYPE" | "NO_ACTIVE_SET";

export interface CriteriaForAftest {
  readonly criterionSet: CriterionSetDetail | null;
  readonly reason: CriteriaForAftestReason | null;
}

/**
 * The pinned, ACTIVE criterion set the aftest screen for this session grades
 * against — the `listCriteriaForGroup` resolution chain (`@/modules/skills`),
 * reused here rather than re-derived, because `assessment` has the same three
 * dependencies skills does (`groups` for the level, `courses` for the award
 * type, `skills` for the set) and the chain is a cross-module composition,
 * not a table either module owns twice.
 *
 * Guards `{ session }`, on `recordAssessment`'s own guard — the SAME resource
 * kind, so the independent assessor who may write here can also read what to
 * grade. `{ group }` would deny exactly that caller (a `SESSION` reach never
 * covers `{ group }`).
 */
export async function criteriaForSessionAftest(
  actor: ActorContext,
  scheduledSessionId: string,
): Promise<CriteriaForAftest> {
  const at = instant(actor);
  await requirePermission(
    actor.principal,
    "assessment.read",
    { session: scheduledSessionId },
    { at },
  );

  const session = await findSessionRegisterFacts(scheduledSessionId);
  if (session === null) throw new AssessmentError("SESSION_NOT_FOUND");

  const courseLevelId = await courseLevelOfGroup(session.groupId);
  if (courseLevelId === null) return { criterionSet: null, reason: "NO_LEVEL" };

  const awardTypeId = await awardTypeOfCourseLevel(courseLevelId);
  if (awardTypeId === null) {
    return { criterionSet: null, reason: "NO_AWARD_TYPE" };
  }

  const activeSet = await activeCriterionSetOfAwardType(awardTypeId);
  if (activeSet === null)
    return { criterionSet: null, reason: "NO_ACTIVE_SET" };

  const criterionSet = await criterionSetDetailForAssessment(activeSet.id);
  return { criterionSet, reason: null };
}
