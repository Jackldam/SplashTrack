"use server";

/**
 * The `exams` area's Server Actions — the `groups/actions.ts` shape.
 *
 * Every action is a thin shell around a service: it resolves the acting
 * person from the SESSION (never from a form field), hands the raw fields to
 * the service, and lets the service run `requirePermission`, validate the
 * input and write the audit event. The screen that renders these forms lives
 * on the person page (`/people/[personId]`), which is where every redirect
 * below returns to.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  confirmExamCandidate,
  ExamCandidateError,
  ExamResultError,
  grantQualification,
  issueAward,
  PersonQualificationError,
  recordExamResult,
  registerExamCandidate,
  revokeAward,
  withdrawExamCandidate,
  type ActorContext,
} from "@/modules/exams";

const actionLogger = logger.child({ component: "exams.actions" });

async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (error instanceof ExamCandidateError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ExamResultError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof PersonQualificationError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "exams.action.rejected", code: error.code },
      "an exams action was rejected by validation",
    );
    redirect(`${back}?error=validation`);
  }
  throw error;
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

async function run(
  back: string,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (isRedirect(error)) throw error;
    refusal(error, back);
  }
}

export async function registerExamCandidateAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await registerExamCandidate(await actor(), {
      studentProfileId: formData.get("studentProfileId"),
      awardTypeId: formData.get("awardTypeId"),
      groupId: formData.get("groupId"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=examCandidateRegistered`);
}

export async function confirmExamCandidateAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    const overrideReason = formData.get("overrideReason");
    await confirmExamCandidate(await actor(), {
      candidateId: formData.get("candidateId"),
      overrideReason:
        overrideReason && String(overrideReason).trim().length > 0
          ? overrideReason
          : undefined,
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=examCandidateConfirmed`);
}

export async function withdrawExamCandidateAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await withdrawExamCandidate(await actor(), {
      candidateId: formData.get("candidateId"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=examCandidateWithdrawn`);
}

export async function recordExamResultAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await recordExamResult(await actor(), {
      candidateId: formData.get("candidateId"),
      outcome: formData.get("outcome"),
      remarks: formData.get("remarks"),
      clientEventId: formData.get("clientEventId"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=examResultRecorded`);
}

export async function issueAwardAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await issueAward(await actor(), {
      resultId: formData.get("resultId"),
      number: formData.get("number"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=awardIssued`);
}

export async function revokeAwardAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await revokeAward(await actor(), {
      awardId: formData.get("awardId"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=awardRevoked`);
}

export async function grantQualificationAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const back = `/people/${personId}`;
  await run(back, async () => {
    await grantQualification(await actor(), {
      personId: formData.get("qualificationPersonId"),
      type: formData.get("type"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=qualificationGranted`);
}
