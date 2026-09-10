/**
 * `ExamResult` and `Award` — the exam-day outcome and the issued document
 * (`01-domain-model.md` §3.5; D-062, D-082, D-089).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `{ session }` WHEN A SESSION IS GIVEN, `{ student }` OTHERWISE — D-052/D-068
 *
 * An external examiner (D-052) holds no standing grant over the child at all;
 * their only reach is `SESSION` (D-068), over the LESSON SLOT the exam day
 * happened to use — `ExamResult.scheduledSessionId`, the
 * `Assessment.scheduledSessionId` precedent, reused rather than a second
 * scheduling primitive (see the schema's own file comment for why
 * `ExamSession` is not built). An internal examiner or an administrator
 * recording a correction weeks later, with no specific lesson slot in mind,
 * guards on `{ student }` instead. This is a call this phase makes, not a
 * literal reading of the design — flagged in the phase 2.4 report.
 *
 * SERVER-ONLY.
 */
import { randomUUID } from "node:crypto";

import { requirePermission, type Principal } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import {
  optionalText,
  requiredDate,
  requiredEnum,
  requiredText,
} from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";
import { findSessionRegisterFacts } from "@/modules/sessions";

import {
  effectiveResultsByCandidate,
  ExamResultError,
  type ExamResultEntry,
  type ExamResultOutcomeValue,
} from "../domain/exam-result";
import { findExamCandidateById } from "../infrastructure/exam-candidate-repository";
import {
  findExamResultById,
  findExamResultsForCandidate,
  type ExamResultView,
} from "../infrastructure/exam-result-repository";
import { TEXT_MAX } from "./input";

export { ExamResultError };
export type { ExamResultView, ExamResultOutcomeValue };

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface RecordExamResultInput {
  candidateId: unknown;
  outcome: unknown;
  recordedAt?: unknown;
  supersedesResultId?: unknown;
  reason?: unknown;
  remarks?: unknown;
  scheduledSessionId?: unknown;
  clientEventId: unknown;
}

const OUTCOMES = ["PASS", "FAIL"] as const;

/**
 * Records one exam-day outcome — append-only (D-062). A correction is the
 * SAME call with `supersedesResultId` set, the `recordAssessment` shape.
 */
export async function recordExamResult(
  actor: ActorContext,
  input: RecordExamResultInput,
): Promise<{ id: string; outcome: ExamResultOutcomeValue }> {
  const at = instant(actor);
  const candidateId = requiredText(
    "candidateId",
    input.candidateId,
    TEXT_MAX.id,
  );
  const outcome = requiredEnum("outcome", input.outcome, OUTCOMES);
  const recordedAt =
    input.recordedAt === undefined ||
    input.recordedAt === null ||
    input.recordedAt === ""
      ? at
      : requiredDate("recordedAt", input.recordedAt);
  const clientEventId = requiredText(
    "clientEventId",
    input.clientEventId,
    TEXT_MAX.id,
  );
  const remarks = optionalText("remarks", input.remarks, TEXT_MAX.remarks);
  const scheduledSessionId =
    input.scheduledSessionId === undefined ||
    input.scheduledSessionId === null ||
    input.scheduledSessionId === ""
      ? null
      : requiredText(
          "scheduledSessionId",
          input.scheduledSessionId,
          TEXT_MAX.id,
        );
  const supersedesResultId =
    input.supersedesResultId === undefined ||
    input.supersedesResultId === null ||
    input.supersedesResultId === ""
      ? null
      : requiredText(
          "supersedesResultId",
          input.supersedesResultId,
          TEXT_MAX.id,
        );
  const reason = optionalText("reason", input.reason, TEXT_MAX.reason);

  if (supersedesResultId !== null && reason === null) {
    throw new ExamResultError("CORRECTION_REASON_REQUIRED");
  }

  const candidate = await findExamCandidateById(candidateId);
  if (candidate === null) throw new ExamResultError("CANDIDATE_NOT_FOUND");
  if (candidate.status !== "CONFIRMED") {
    throw new ExamResultError("CANDIDATE_NOT_CONFIRMED");
  }

  if (scheduledSessionId !== null) {
    await requirePermission(
      actor.principal,
      "exams.results.record",
      { session: scheduledSessionId },
      { at },
    );
    const session = await findSessionRegisterFacts(scheduledSessionId);
    if (
      session !== null &&
      !session.rosterStudentProfileIds.includes(candidate.studentProfileId)
    ) {
      throw new ExamResultError("CANDIDATE_NOT_FOUND");
    }
  } else {
    await requirePermission(
      actor.principal,
      "exams.results.record",
      { student: candidate.studentProfileId },
      { at },
    );
  }

  return prisma.$transaction(async (tx) => {
    const replay = await tx.examResult.findUnique({
      where: { clientEventId },
      select: { id: true, outcome: true },
    });
    if (replay !== null) return replay;

    if (supersedesResultId !== null) {
      const superseded = await tx.examResult.findUnique({
        where: { id: supersedesResultId },
        select: { candidateId: true },
      });
      if (superseded === null || superseded.candidateId !== candidateId) {
        throw new ExamResultError("SUPERSEDED_RESULT_MISMATCH");
      }
    }

    const resultId = randomUUID();
    await tx.examResult.create({
      data: {
        id: resultId,
        candidateId,
        outcome,
        recordedByPersonId: actor.principal.personId,
        recordedAt,
        supersedesResultId,
        reason,
        remarks,
        assessmentId: candidate.qualifyingAssessmentId,
        scheduledSessionId,
        clientEventId,
      },
    });

    await recordAuditEvent(
      {
        eventType: "exams.result.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: candidate.studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: {
          resultId,
          candidateId,
          outcome,
          supersedesResultId,
          remarksGiven: remarks !== null,
        },
        reason,
      },
      tx,
    );

    return { id: resultId, outcome };
  });
}

/** A candidate's results, most recent first, with the effective one flagged. */
export async function getExamResultsForCandidate(
  actor: ActorContext,
  candidateId: string,
): Promise<{ results: ExamResultView[]; effectiveResultId: string | null }> {
  const at = instant(actor);
  const candidate = await findExamCandidateById(candidateId);
  if (candidate === null) throw new ExamResultError("CANDIDATE_NOT_FOUND");

  await requirePermission(
    actor.principal,
    "exams.read",
    { student: candidate.studentProfileId },
    { at },
  );

  const results = await findExamResultsForCandidate(candidateId);
  const entries: ExamResultEntry[] = results.map((r) => ({
    id: r.id,
    candidateId: r.candidateId,
    outcome: r.outcome,
    recordedAt: r.recordedAt,
    supersedesResultId: r.supersedesResultId,
  }));
  const effective = effectiveResultsByCandidate(entries).get(candidateId);
  return { results, effectiveResultId: effective?.resultId ?? null };
}

export interface IssueAwardInput {
  resultId: unknown;
  number: unknown;
  issuedAt?: unknown;
}

/** Issues an `Award` against a specific, effective, PASS `ExamResult`. */
export async function issueAward(
  actor: ActorContext,
  input: IssueAwardInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const resultId = requiredText("resultId", input.resultId, TEXT_MAX.id);
  const number = requiredText("number", input.number, TEXT_MAX.awardNumber);
  const issuedAt =
    input.issuedAt === undefined ||
    input.issuedAt === null ||
    input.issuedAt === ""
      ? at
      : requiredDate("issuedAt", input.issuedAt);

  const result = await findExamResultById(resultId);
  if (result === null) throw new ExamResultError("RESULT_NOT_FOUND");
  if (result.outcome !== "PASS") throw new ExamResultError("RESULT_NOT_PASS");
  if (result.award !== null)
    throw new ExamResultError("RESULT_ALREADY_HAS_AWARD");

  const candidate = await findExamCandidateById(result.candidateId);
  if (candidate === null) throw new ExamResultError("CANDIDATE_NOT_FOUND");

  await requirePermission(
    actor.principal,
    "certificates.issue",
    { student: candidate.studentProfileId },
    { at },
  );

  return prisma.$transaction(async (tx) => {
    const award = await tx.award.create({
      data: {
        resultId,
        awardTypeId: candidate.awardTypeId,
        number,
        issuedAt,
      },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "exams.award.issued",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: candidate.studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: { awardId: award.id, resultId, number },
      },
      tx,
    );

    return { id: award.id };
  });
}

export interface RevokeAwardInput {
  awardId: unknown;
  reason: unknown;
}

/**
 * Revokes an issued `Award` — the ONE mutation this module's append-only
 * shape permits (`Award.revokedAt`/`revokeReason`, column-restricted at the
 * database — see the model comment). Never edits `number`/`issuedAt`.
 */
export async function revokeAward(
  actor: ActorContext,
  input: RevokeAwardInput,
): Promise<void> {
  const at = instant(actor);
  const awardId = requiredText("awardId", input.awardId, TEXT_MAX.id);
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  const award = await prisma.award.findUnique({
    where: { id: awardId },
    select: { id: true, resultId: true, revokedAt: true },
  });
  if (award === null) throw new ExamResultError("AWARD_NOT_FOUND");
  if (award.revokedAt !== null)
    throw new ExamResultError("AWARD_ALREADY_REVOKED");

  const result = await findExamResultById(award.resultId);
  const candidate = result
    ? await findExamCandidateById(result.candidateId)
    : null;
  if (candidate === null) throw new ExamResultError("CANDIDATE_NOT_FOUND");

  await requirePermission(
    actor.principal,
    "certificates.revoke",
    { student: candidate.studentProfileId },
    { at },
  );

  await prisma.$transaction(async (tx) => {
    await tx.award.update({
      where: { id: awardId },
      data: { revokedAt: at, revokeReason: reason },
    });

    await recordAuditEvent(
      {
        eventType: "exams.award.revoked",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: candidate.studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: { awardId },
        reason,
      },
      tx,
    );
  });
}
