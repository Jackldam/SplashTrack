"use server";

/**
 * The settings page's Server Action.
 *
 * ONE ACTION, EVERY SETTING. A single form-per-setting posts here with a
 * hidden `key` field; `updateSetting` (`@/modules/settings`) is the only
 * place that decides anything — `requirePermission`, the `invariant` refusal,
 * the Zod schema, D-141's lockout check and the audit event. This action only
 * resolves the session, coerces the submitted field to the shape the
 * setting's `type` implies, and redirects back with a result key — the
 * `people/actions.ts` precedent: never echo the submitted value into the URL.
 *
 * LIVE, NO RESTART: the redirect re-renders the page from a fresh read, which
 * is the same read every other request now sees (`13-…` §4) — there is
 * nothing to restart and nothing cached to invalidate.
 */

import { redirect } from "next/navigation";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  LockoutInvariantViolationError,
  settingDefinition,
  updateSetting,
} from "@/modules/settings";

const actionLogger = logger.child({ component: "settings.actions" });

function coerce(rawType: string, raw: FormDataEntryValue | null): unknown {
  switch (rawType) {
    case "boolean":
      return raw === "true";
    case "number": {
      if (raw == null || raw === "") return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case "string":
    case "enum":
      return raw == null || raw === "" ? null : String(raw);
    case "secret": {
      if (raw === "__CLEAR__") return null;
      return raw == null || raw === "" ? undefined : String(raw);
    }
    default:
      return raw;
  }
}

export async function updateSettingAction(formData: FormData): Promise<void> {
  const session = await requireEnrolledSession();
  const key = String(formData.get("key") ?? "");
  const definition = settingDefinition(key);

  if (!definition) {
    redirect(`/admin/settings?error=unknown_setting`);
  }

  const value = coerce(definition.type, formData.get("value"));

  // `secret` left blank means "leave unchanged" — do not attempt a write at
  // all rather than writing `undefined`, which the Zod schema would refuse.
  if (definition.type === "secret" && value === undefined) {
    redirect(`/admin/settings?updated=${encodeURIComponent(key)}`);
  }

  try {
    await updateSetting({
      principal: { personId: session.person.id },
      key,
      value,
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      redirect(`/admin/settings?error=denied`);
    }
    if (error instanceof LockoutInvariantViolationError) {
      redirect(`/admin/settings?error=lockout_invariant`);
    }
    if (error instanceof ApiError) {
      redirect(
        `/admin/settings?error=validation&field=${encodeURIComponent(key)}`,
      );
    }
    actionLogger.error(
      { event: "settings.action.unexpected_error", err: error, key },
      "unexpected error updating a setting",
    );
    throw error;
  }

  redirect(`/admin/settings?updated=${encodeURIComponent(key)}`);
}
