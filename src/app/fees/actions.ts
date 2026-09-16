"use server";

/**
 * The `fees` area's Server Actions — the `src/app/courses/actions.ts` shape.
 *
 * EVERY ACTION IS A THIN SHELL AROUND A SERVICE. A Server Action is an
 * unauthenticated HTTP endpoint until something authenticates it, and it
 * accepts a `FormData` from anywhere — not only from the form that rendered
 * it. So nothing here decides anything: each action resolves the session,
 * hands the raw fields to the service, and lets the service run
 * `requirePermission`, validate the input and write the audit event.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  cancelCharge,
  ChargeError,
  createCharge,
  createFeeType,
  FeeTypeError,
  parseEurosToMinorUnits,
  PaymentError,
  recordPayment,
  updateFeeType,
  waiveCharge,
  type ActorContext,
} from "@/modules/fees";

/**
 * `<input type="number" step="0.01">` submits whole currency units
 * (`"67.50"`); every service in this module wants minor units. Converts
 * here, at the form boundary — never with `Number(x) * 100`, see
 * `parseEurosToMinorUnits`'s own comment. A value that does not parse is
 * passed through as `null`, which the service's own `requiredInt` refuses
 * with an ordinary validation error rather than this file inventing a
 * second message for the same case.
 */
function eurosField(formData: FormData, field: string): number | null {
  const raw = formData.get(field);
  return typeof raw === "string" ? parseEurosToMinorUnits(raw) : null;
}

const actionLogger = logger.child({ component: "fees.actions" });

/** The actor, from the SESSION — never from a form field. */
async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

function refusal(error: unknown, back: string): never {
  if (error instanceof PermissionDeniedError) {
    redirect(`${back}?error=denied`);
  }
  if (
    error instanceof FeeTypeError ||
    error instanceof ChargeError ||
    error instanceof PaymentError
  ) {
    redirect(`${back}?error=${encodeURIComponent(error.reason)}`);
  }
  if (error instanceof ApiError) {
    actionLogger.debug(
      { event: "fees.action.rejected", code: error.code },
      "a fees action was rejected by validation",
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

/**
 * The page to return to after a charge-row action (waive/cancel/record
 * payment). Both balance views live embedded on the PERSON screen
 * (`src/app/people/[personId]/page.tsx` — see that file's "Financiën"
 * sections), never on a route of their own, so this is always a person page.
 * A redirect target read out of a `FormData` is attacker-supplied, so it is
 * checked against a fixed shape rather than trusted, the `personPath`
 * precedent (`src/app/courses/actions.ts`).
 */
function backPath(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  return /^\/people\/[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "/fees";
}

// ── fee types ───────────────────────────────────────────────────────────────

export async function createFeeTypeAction(formData: FormData): Promise<void> {
  await run("/fees", async () => {
    await createFeeType(await actor(), {
      code: formData.get("code"),
      name: formData.get("name"),
      amount: eurosField(formData, "amount"),
      recurrence: formData.get("recurrence"),
    });
  });
  revalidatePath("/fees");
  redirect("/fees?saved=feeType");
}

export async function updateFeeTypeAction(formData: FormData): Promise<void> {
  const feeTypeId = String(formData.get("feeTypeId") ?? "");
  await run("/fees", async () => {
    await updateFeeType(await actor(), feeTypeId, {
      name: formData.get("name"),
      amount: eurosField(formData, "amount"),
      active: formData.get("active"),
    });
  });
  revalidatePath("/fees");
  redirect("/fees?saved=feeTypeUpdated");
}

// ── charges ─────────────────────────────────────────────────────────────────

export async function createChargeAction(formData: FormData): Promise<void> {
  const payerPersonId = String(formData.get("payerPersonId") ?? "");
  let created: { id: string } | null = null;
  await run("/fees", async () => {
    created = await createCharge(await actor(), {
      feeTypeId: formData.get("feeTypeId"),
      payerPersonId: formData.get("payerPersonId"),
      studentProfileId: formData.get("studentProfileId"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      dueDate: formData.get("dueDate"),
      note: formData.get("note"),
      clientEventId: formData.get("clientEventId"),
    });
  });
  revalidatePath(`/people/${payerPersonId}`);
  // The new charge's own balance lives on the PAYER's person page — see the
  // `backPath` comment above.
  if (created) redirect(`/people/${payerPersonId}?saved=chargeCreated`);
}

export async function waiveChargeAction(formData: FormData): Promise<void> {
  const back = backPath(formData.get("back"));
  await run(back, async () => {
    await waiveCharge(await actor(), {
      chargeId: formData.get("chargeId"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=waived`);
}

export async function cancelChargeAction(formData: FormData): Promise<void> {
  const back = backPath(formData.get("back"));
  await run(back, async () => {
    await cancelCharge(await actor(), {
      chargeId: formData.get("chargeId"),
      reason: formData.get("reason"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=cancelled`);
}

// ── payments ────────────────────────────────────────────────────────────────

export async function recordPaymentAction(formData: FormData): Promise<void> {
  const back = backPath(formData.get("back"));
  await run(back, async () => {
    await recordPayment(await actor(), {
      chargeId: formData.get("chargeId"),
      amount: eurosField(formData, "amount"),
      receivedAt: formData.get("receivedAt"),
      method: formData.get("method"),
      reference: formData.get("reference"),
      clientEventId: formData.get("clientEventId"),
    });
  });
  revalidatePath(back);
  redirect(`${back}?saved=payment`);
}
