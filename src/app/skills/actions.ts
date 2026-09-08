"use server";

/**
 * The `skills` area's Server Actions — the `src/app/courses/actions.ts` shell:
 * each action resolves the session, hands the raw fields to the service, and
 * lets the service guard, validate and audit. No branch here reads or writes
 * a table.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  createAwardType,
  createCriterion,
  createCriterionSet,
  CriterionError,
  CriterionSetError,
  publishCriterionSet,
  recordSkillProgress,
  SkillProgressError,
  updateAwardType,
  updateCriterion,
  updateCriterionSet,
  type ActorContext,
} from "@/modules/skills";

const actionLogger = logger.child({ component: "skills.actions" });

async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (
    error instanceof CriterionSetError ||
    error instanceof CriterionError ||
    error instanceof SkillProgressError
  ) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "skills.action.rejected", code: error.code },
      "a skills action was rejected by validation",
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

/**
 * The group or person screen this progress form came from, or the skills
 * catalogue. ONE SHAPE ONLY per prefix, on the `personPath` pattern in
 * `src/app/courses/actions.ts` — a redirect target read out of a `FormData`
 * is attacker-supplied.
 */
function backPath(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  return /^\/(groups|people)\/[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : "/skills";
}

// ── award types ─────────────────────────────────────────────────────────────

export async function createAwardTypeAction(formData: FormData): Promise<void> {
  let created: { id: string } | null = null;
  await run("/skills", async () => {
    created = await createAwardType(await actor(), {
      code: formData.get("code"),
      name: formData.get("name"),
      kind: formData.get("kind"),
      issuingBody: formData.get("issuingBody"),
    });
  });
  revalidatePath("/skills");
  if (created) redirect(`/skills/${(created as { id: string }).id}`);
}

export async function updateAwardTypeAction(formData: FormData): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  await run(`/skills/${awardTypeId}`, async () => {
    await updateAwardType(await actor(), awardTypeId, {
      name: formData.get("name"),
      issuingBody: formData.get("issuingBody"),
    });
  });
  revalidatePath(`/skills/${awardTypeId}`);
  redirect(`/skills/${awardTypeId}?saved=awardType`);
}

// ── criterion sets ──────────────────────────────────────────────────────────

export async function createCriterionSetAction(
  formData: FormData,
): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  let created: { id: string } | null = null;
  await run(`/skills/${awardTypeId}`, async () => {
    created = await createCriterionSet(await actor(), awardTypeId, {
      source: formData.get("source"),
    });
  });
  revalidatePath(`/skills/${awardTypeId}`);
  if (created) {
    redirect(`/skills/${awardTypeId}/sets/${(created as { id: string }).id}`);
  }
}

export async function updateCriterionSetAction(
  formData: FormData,
): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  const criterionSetId = String(formData.get("criterionSetId") ?? "");
  const back = `/skills/${awardTypeId}/sets/${criterionSetId}`;
  await run(back, async () => {
    await updateCriterionSet(await actor(), criterionSetId, {
      source: formData.get("source"),
      passFloorGradeId: formData.get("passFloorGradeId"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=criterionSet`);
}

export async function publishCriterionSetAction(
  formData: FormData,
): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  const criterionSetId = String(formData.get("criterionSetId") ?? "");
  const back = `/skills/${awardTypeId}/sets/${criterionSetId}`;
  await run(back, async () => {
    await publishCriterionSet(await actor(), criterionSetId);
  });
  revalidatePath(back);
  revalidatePath(`/skills/${awardTypeId}`);
  redirect(`${back}?saved=published`);
}

// ── criteria ─────────────────────────────────────────────────────────────────

export async function createCriterionAction(formData: FormData): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  const criterionSetId = String(formData.get("criterionSetId") ?? "");
  const back = `/skills/${awardTypeId}/sets/${criterionSetId}`;
  await run(back, async () => {
    await createCriterion(await actor(), criterionSetId, {
      code: formData.get("code"),
      name: formData.get("name"),
      sequence: formData.get("sequence"),
      minimumGradeId: formData.get("minimumGradeId"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=criterion`);
}

export async function updateCriterionAction(formData: FormData): Promise<void> {
  const awardTypeId = String(formData.get("awardTypeId") ?? "");
  const criterionSetId = String(formData.get("criterionSetId") ?? "");
  const back = `/skills/${awardTypeId}/sets/${criterionSetId}`;
  await run(back, async () => {
    await updateCriterion(
      await actor(),
      String(formData.get("criterionId") ?? ""),
      {
        code: formData.get("code"),
        name: formData.get("name"),
        sequence: formData.get("sequence"),
        minimumGradeId: formData.get("minimumGradeId"),
      },
    );
  });
  revalidatePath(back);
  redirect(`${back}?saved=criterionUpdated`);
}

// ── progress log ─────────────────────────────────────────────────────────────

/**
 * Records one observation from a group's own roster. `groupId` names the
 * resource `recordSkillProgress` guards (`{ group }`); `back` is where the
 * form lives, always the group screen it was submitted from.
 */
export async function recordSkillProgressAction(
  formData: FormData,
): Promise<void> {
  const back = backPath(formData.get("back"));
  await run(back, async () => {
    await recordSkillProgress(
      await actor(),
      String(formData.get("groupId") ?? ""),
      {
        studentProfileId: formData.get("studentProfileId"),
        criterionId: formData.get("criterionId"),
        state: formData.get("state"),
        note: formData.get("note"),
      },
    );
  });
  revalidatePath(back);
  redirect(`${back}?saved=progress`);
}
