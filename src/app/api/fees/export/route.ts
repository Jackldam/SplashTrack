/**
 * The CSV export, over HTTP — R-32's "CSV export ... deterministic, safely
 * escaped" (`15-…` §6.1). The `src/app/api/skills/catalogue/route.ts`
 * precedent: a ROUTE HANDLER, not a Server Action, because a Server Action
 * cannot return a downloadable file — `GET` needs
 * `Content-Disposition: attachment`, which only a `Response`/`NextResponse`
 * can set.
 *
 * The route does nothing `exportFeesCsv` does not already do: the guard
 * (`fees.export`), the audit write and the CSV itself all happen inside that
 * one function. This file only resolves the session and shapes HTTP.
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { toErrorResponse } from "@/lib/errors";
import { exportFeesCsv, type ActorContext } from "@/modules/fees";

async function actor(): Promise<ActorContext> {
  const session = await requireEnrolledSession();
  return { principal: { personId: session.person.id }, at: new Date() };
}

/** `PermissionDeniedError` as a 403 — `toErrorResponse` does not know it. */
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

export async function GET() {
  const requestId = randomUUID();
  try {
    const csv = await exportFeesCsv(await actor());
    const filename = `financien-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return (
      deniedResponse(error, requestId) ?? toErrorResponse(error, requestId)
    );
  }
}
