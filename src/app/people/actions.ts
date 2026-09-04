"use server";

/**
 * The `people` area's Server Actions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ACTION IS A THIN SHELL AROUND A SERVICE, AND THAT IS THE POINT
 *
 * A Server Action is an unauthenticated HTTP endpoint until something
 * authenticates it, and it accepts a `FormData` from anywhere — not only from
 * the form that rendered it. So nothing here decides anything: each action
 * resolves the session, hands the raw fields to the service, and lets the
 * service run `requirePermission`, validate the input and write the audit
 * event. There is no branch in this file that reads or writes a table.
 *
 * That is also why none of them trusts a hidden field for the ACTOR. The acting
 * person comes from the session and never from the form; the form supplies only
 * the SUBJECT, which the service then guards on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW A FAILURE REACHES THE PERSON WHO CAUSED IT
 *
 * `redirect(...?error=...)` with a message key, in the shape `sign-in/actions.ts`
 * already uses. Deliberately coarse: the key names WHICH step refused, and the
 * screen renders the Dutch sentence. It does not echo the submitted value back
 * into a URL, which is how personal data ends up in a proxy access log.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  createMembership,
  createPerson,
  createStudentProfile,
  endMembershipPeriod,
  endRelationship,
  MembershipPeriodError,
  recordLifecycleEvent,
  recordRelationship,
  startMembershipPeriod,
  updatePerson,
  type ActorContext,
} from "@/modules/people";

const actionLogger = logger.child({ component: "people.actions" });

/** The actor, from the SESSION — never from a form field. */
async function actor(): Promise<ActorContext> {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");
  return { principal: { personId: session.person.id }, at: new Date() };
}

/**
 * Turns a thrown refusal into a redirect the screen can explain.
 *
 * `PermissionDeniedError` is logged by the guard itself, so it is not logged
 * again here. A validation or domain refusal is logged at debug — it is an
 * ordinary outcome of a person typing something, not an incident.
 */
function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (error instanceof MembershipPeriodError) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "people.action.rejected", code: error.code },
      "a people action was rejected by validation",
    );
    redirect(`${back}?error=validation`);
  }
  throw error;
}

/** `redirect()` throws a control-flow signal Next must see; never swallow it. */
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

export async function createPersonAction(formData: FormData): Promise<void> {
  let created: { id: string } | null = null;
  await run("/people", async () => {
    created = await createPerson(await actor(), {
      givenName: formData.get("givenName"),
      familyName: formData.get("familyName"),
      dateOfBirth: formData.get("dateOfBirth"),
      email: formData.get("email"),
      phone: formData.get("phone"),
    });
  });
  revalidatePath("/people");
  if (created) redirect(`/people/${(created as { id: string }).id}`);
}

export async function updatePersonAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  await run(`/people/${personId}`, async () => {
    await updatePerson(await actor(), personId, {
      givenName: formData.get("givenName"),
      familyName: formData.get("familyName"),
      dateOfBirth: formData.get("dateOfBirth"),
      email: formData.get("email"),
      phone: formData.get("phone"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=person`);
}

export async function createMembershipAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  await run(`/people/${personId}`, async () => {
    await createMembership(await actor(), personId, {
      memberNumber: formData.get("memberNumber"),
      startedAt: formData.get("startedAt"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=membership`);
}

export async function startMembershipPeriodAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  await run(`/people/${personId}`, async () => {
    await startMembershipPeriod(await actor(), personId, {
      startedAt: formData.get("startedAt"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=periodStarted`);
}

export async function endMembershipPeriodAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  await run(`/people/${personId}`, async () => {
    await endMembershipPeriod(await actor(), personId, {
      endedAt: formData.get("endedAt"),
      endReason: formData.get("endReason"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=periodEnded`);
}

export async function createStudentProfileAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  await run(`/people/${personId}`, async () => {
    await createStudentProfile(await actor(), personId, {
      studentNumber: formData.get("studentNumber"),
      openingEvent: formData.get("openingEvent"),
      occurredAt: formData.get("occurredAt"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=student`);
}

export async function recordLifecycleEventAction(
  formData: FormData,
): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const studentProfileId = String(formData.get("studentProfileId") ?? "");
  await run(`/people/${personId}`, async () => {
    await recordLifecycleEvent(await actor(), studentProfileId, {
      type: formData.get("type"),
      occurredAt: formData.get("occurredAt"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=lifecycle`);
}

export async function recordRelationshipAction(
  formData: FormData,
): Promise<void> {
  const subjectPersonId = String(formData.get("subjectPersonId") ?? "");
  await run(`/people/${subjectPersonId}`, async () => {
    await recordRelationship(await actor(), {
      subjectPersonId,
      relativePersonId: String(formData.get("relativePersonId") ?? ""),
      type: formData.get("type"),
      authority: formData.get("authority") === "on",
      evidence: formData.get("evidence"),
      validFrom: formData.get("validFrom"),
    });
  });
  revalidatePath(`/people/${subjectPersonId}`);
  redirect(`/people/${subjectPersonId}?saved=relationship`);
}

export async function endRelationshipAction(formData: FormData): Promise<void> {
  const personId = String(formData.get("personId") ?? "");
  const relationshipId = String(formData.get("relationshipId") ?? "");
  await run(`/people/${personId}`, async () => {
    await endRelationship(await actor(), relationshipId, {
      validTo: formData.get("validTo"),
    });
  });
  revalidatePath(`/people/${personId}`);
  redirect(`/people/${personId}?saved=relationshipEnded`);
}
