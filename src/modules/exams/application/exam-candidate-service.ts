/**
 * `ExamCandidate` — the candidacy state machine (`01-domain-model.md` §3.5),
 * and D-085's full four-eyes gate, finally enforceable at the write this
 * design always meant it for: `ExamCandidate -> CONFIRMED`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SERVICE READS THROUGH `assessment`'S PUBLISHED SERVICE, NEVER ITS
 * TABLES (D-057, `CLAUDE.md` §4, `01-domain-model.md` line ~130)
 *
 * `qualifyingAftestFacts(studentProfileId, awardTypeId)` — the structured
 * fact `assessment` (phase 2.3) built exactly for this moment. See
 * `domain/exam-candidate.ts` for why calling it HERE, at confirmation time,
 * is a genuine re-verification of independence rather than a rubber stamp of
 * assessment's write-time decision, and for the full D-085 formula this
 * module folds `PersonQualification` into.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `groupId` IS A CALLER-SUPPLIED SNAPSHOT, NOT A RESOLVED "CURRENT GROUP"
 *
 * A pupil may belong to more than one group at once (D-060). Rather than
 * inventing a "the" current group resolver this module would have to defend,
 * the caller states which group's context this candidacy is registered
 * under — validated against `activeGroupMemberIds` (`groups`' own published
 * fact) so it cannot be an arbitrary id. Flagged in the phase 2.4 report as
 * the same open reading the assessment phase named for
 * `isActiveInstructorOfStudent` (§1's item 7): D-085 says "that student's
 * group", singular, and this is ambiguous the moment a pupil is in several.
 *
 * SERVER-ONLY.
 */
import {
  PermissionDeniedError,
  requirePermission,
  type Principal,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { requiredText, optionalText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";
import { activeGroupMemberIds } from "@/modules/groups";
import { qualifyingAftestFacts } from "@/modules/assessment";

import {
  ExamCandidateError,
  firstUnmetClause,
  type ConfirmationChecks,
} from "../domain/exam-candidate";
import { hasValidQualification } from "../infrastructure/person-qualification-repository";
import {
  findExamCandidateById,
  findExamCandidatesForStudent,
  type ExamCandidateView,
} from "../infrastructure/exam-candidate-repository";
import { TEXT_MAX } from "./input";

export { ExamCandidateError };
export type { ExamCandidateView };

export interface ActorContext {
  readonly principal: Principal;
  readonly requestId?: string | null;
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface RegisterExamCandidateInput {
  studentProfileId: unknown;
  awardTypeId: unknown;
  groupId: unknown;
}

/** Registers a candidacy — `PENDING`, nothing else decided yet. */
export async function registerExamCandidate(
  actor: ActorContext,
  input: RegisterExamCandidateInput,
): Promise<{ id: string }> {
  const at = instant(actor);
  const studentProfileId = requiredText(
    "studentProfileId",
    input.studentProfileId,
    TEXT_MAX.id,
  );
  const awardTypeId = requiredText(
    "awardTypeId",
    input.awardTypeId,
    TEXT_MAX.id,
  );
  const groupId = requiredText("groupId", input.groupId, TEXT_MAX.id);

  await requirePermission(
    actor.principal,
    "exams.manage",
    { student: studentProfileId },
    { at },
  );

  const members = await activeGroupMemberIds(groupId, at);
  if (!members.includes(studentProfileId)) {
    throw new ExamCandidateError("STUDENT_NOT_IN_GROUP");
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.examCandidate.create({
      data: { studentProfileId, awardTypeId, groupId },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "exams.candidate.registered",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: { candidateId: row.id, awardTypeId, groupId },
      },
      tx,
    );

    return { id: row.id };
  });
}

export interface ConfirmExamCandidateInput {
  candidateId: unknown;
  overrideReason?: unknown;
}

/**
 * `ExamCandidate -> CONFIRMED` — D-085's full formula, checked here, at
 * exactly the write the design always meant to gate. See the file comment.
 */
export async function confirmExamCandidate(
  actor: ActorContext,
  input: ConfirmExamCandidateInput,
): Promise<{ id: string; overrideUsed: boolean }> {
  const at = instant(actor);
  const candidateId = requiredText(
    "candidateId",
    input.candidateId,
    TEXT_MAX.id,
  );
  const overrideReason = optionalText(
    "overrideReason",
    input.overrideReason,
    TEXT_MAX.reason,
  );

  const candidate = await findExamCandidateById(candidateId);
  if (candidate === null) throw new ExamCandidateError("CANDIDATE_NOT_FOUND");

  await requirePermission(
    actor.principal,
    "exams.manage",
    { student: candidate.studentProfileId },
    { at },
  );

  if (candidate.status === "CONFIRMED") {
    throw new ExamCandidateError("ALREADY_CONFIRMED");
  }
  if (candidate.status === "WITHDRAWN") {
    throw new ExamCandidateError("ALREADY_WITHDRAWN");
  }

  const facts = await qualifyingAftestFacts(
    candidate.studentProfileId,
    candidate.awardTypeId,
  );

  const assessorQualified =
    facts.assessorPersonId !== null && facts.assessedAt !== null
      ? await hasValidQualification(facts.assessorPersonId, facts.assessedAt)
      : false;

  const checks: ConfirmationChecks = {
    hasQualifyingAssessment: facts.hasQualifyingAssessment,
    independentOfStudentGroup: facts.independentOfStudentGroup,
    assessorHoldsValidQualification: assessorQualified,
  };

  const failure = firstUnmetClause(checks);
  let overrideUsed = false;

  if (failure !== null) {
    if (overrideReason === null) {
      // Refuse with the SPECIFIC clause that failed, not a generic denial —
      // an exams manager needs to know WHICH of D-085's clauses is unmet to
      // decide whether an override is the right call.
      throw new ExamCandidateError(failure);
    }
    try {
      await requirePermission(
        actor.principal,
        "exams.candidacy.override",
        { student: candidate.studentProfileId },
        { at },
      );
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        throw new ExamCandidateError(failure);
      }
      throw error;
    }
    overrideUsed = true;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.examCandidate.updateMany({
      where: { id: candidateId, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        confirmedAt: at,
        confirmedByPersonId: actor.principal.personId,
        qualifyingAssessmentId: facts.assessmentId,
        overrideUsed,
        overrideReason: overrideUsed ? overrideReason : null,
      },
    });

    if (updated.count === 0) {
      // Lost a race against another confirmation/withdrawal since the read
      // above — re-read to report the ACTUAL current state rather than a
      // generic failure.
      const current = await tx.examCandidate.findUnique({
        where: { id: candidateId },
        select: { status: true },
      });
      throw new ExamCandidateError(
        current?.status === "WITHDRAWN"
          ? "ALREADY_WITHDRAWN"
          : "ALREADY_CONFIRMED",
      );
    }

    await recordAuditEvent(
      {
        eventType: "exams.candidate.confirmed",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: candidate.studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: {
          candidateId,
          hasQualifyingAssessment: checks.hasQualifyingAssessment,
          independentOfStudentGroup: checks.independentOfStudentGroup,
          assessorHoldsValidQualification:
            checks.assessorHoldsValidQualification,
          overrideUsed,
        },
        reason: overrideUsed ? overrideReason : null,
      },
      tx,
    );

    return { id: candidateId, overrideUsed };
  });
}

export interface WithdrawExamCandidateInput {
  candidateId: unknown;
  reason: unknown;
}

/** `ExamCandidate -> WITHDRAWN` — before or after confirmation. */
export async function withdrawExamCandidate(
  actor: ActorContext,
  input: WithdrawExamCandidateInput,
): Promise<void> {
  const at = instant(actor);
  const candidateId = requiredText(
    "candidateId",
    input.candidateId,
    TEXT_MAX.id,
  );
  const reason = requiredText("reason", input.reason, TEXT_MAX.reason);

  const candidate = await findExamCandidateById(candidateId);
  if (candidate === null) throw new ExamCandidateError("CANDIDATE_NOT_FOUND");

  await requirePermission(
    actor.principal,
    "exams.manage",
    { student: candidate.studentProfileId },
    { at },
  );

  if (candidate.status === "WITHDRAWN") {
    throw new ExamCandidateError("ALREADY_WITHDRAWN");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.examCandidate.updateMany({
      where: { id: candidateId, status: { not: "WITHDRAWN" } },
      data: { status: "WITHDRAWN", withdrawnAt: at, withdrawnReason: reason },
    });
    if (updated.count === 0) {
      throw new ExamCandidateError("ALREADY_WITHDRAWN");
    }

    await recordAuditEvent(
      {
        eventType: "exams.candidate.withdrawn",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "student_profile",
        targetId: candidate.studentProfileId,
        requestId: actor.requestId ?? null,
        changedFields: { candidateId },
        reason,
      },
      tx,
    );
  });
}

/** A pupil's candidacies, narrowed to what the caller's `Reach` covers. */
export async function getExamCandidatesForStudent(
  actor: ActorContext,
  studentProfileId: string,
): Promise<ExamCandidateView[]> {
  const at = instant(actor);
  const reach = await requirePermission(
    actor.principal,
    "exams.read",
    { student: studentProfileId },
    { at },
  );
  return findExamCandidatesForStudent(studentProfileId, reach);
}
