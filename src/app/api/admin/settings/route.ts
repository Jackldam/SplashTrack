/**
 * `POST /api/admin/settings` — R-17's write path. One JSON body,
 * `{ key, value }`, one registry setting changed. The route does nothing a
 * service does not already do: `updateSetting` (`@/modules/settings`) is
 * where `requirePermission`, the `invariant` refusal, the Zod schema, D-141's
 * lockout-invariant check and the audit event all live. This file only
 * resolves the session and shapes HTTP in and out (`skills/catalogue/route.ts`
 * precedent).
 *
 * LIVE, NO RESTART (`13-…` §4): the response returns the freshly-read
 * effective value, which is what lets the settings page update in place
 * without a reload and is the same read every OTHER request now sees.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  LockoutInvariantViolationError,
  updateSetting,
} from "@/modules/settings";

const routeLogger = logger.child({ component: "settings.route" });

function deniedResponse(
  error: unknown,
  requestId: string,
): NextResponse | null {
  if (!(error instanceof PermissionDeniedError)) return null;
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN",
        message: `Geen toegang (${error.permission}).`,
        requestId,
        details: [],
      },
    },
    { status: 403, headers: { "x-request-id": requestId } },
  );
}

function lockoutResponse(
  error: unknown,
  requestId: string,
): NextResponse | null {
  if (!(error instanceof LockoutInvariantViolationError)) return null;
  return NextResponse.json(
    {
      error: {
        code: "FORBIDDEN",
        message:
          "Geweigerd: dit zou de installatie zonder een lokaal, MFA-geverifieerd beheerdersaccount achterlaten (D-141).",
        requestId,
        details: [],
      },
    },
    { status: 403, headers: { "x-request-id": requestId } },
  );
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  try {
    const session = await requireEnrolledSession();
    const body = (await request.json()) as { key?: unknown; value?: unknown };
    if (typeof body.key !== "string") {
      throw new ApiError("BAD_REQUEST", "A setting `key` is required.");
    }

    const result = await updateSetting({
      principal: { personId: session.person.id },
      key: body.key,
      value: body.value,
      requestId,
    });

    return NextResponse.json(
      {
        key: result.definition.key,
        value: result.value,
        secretSet: result.secretSet,
        source: result.source,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    const denied = deniedResponse(error, requestId);
    if (denied) return denied;
    const lockout = lockoutResponse(error, requestId);
    if (lockout) return lockout;
    if (!(error instanceof ApiError)) {
      routeLogger.error(
        { event: "settings.route.unexpected_error", err: error, requestId },
        "unexpected error updating a setting",
      );
    }
    return toErrorResponse(error, requestId);
  }
}
