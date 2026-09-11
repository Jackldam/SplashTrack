/**
 * D-188's JSON surface, over HTTP — `GET` exports, `POST` imports.
 *
 * THE ROUTE DOES NOTHING A SERVICE DOES NOT ALREADY DO. `GET` calls
 * `exportCatalogue`, shapes the result as a downloadable attachment; `POST`
 * reads an uploaded file's text, hands it unparsed to `importCatalogue` (which
 * parses AND validates it — `@/modules/skills`'s own file comment explains
 * why there is no separate validation here), and reports either the counts or
 * the first refusal. Every guard (`skills.read` / `skills.manage_catalogue`)
 * and every write still happens inside those two functions; this file only
 * resolves the session and shapes HTTP in and out, the
 * `student-candidates/route.ts` precedent.
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, because a Server Action cannot return
 * a downloadable file — `GET` needs `Content-Disposition: attachment`, which
 * only a `Response`/`NextResponse` can set.
 */
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logging";
import {
  CatalogueImportError,
  exportCatalogue,
  importCatalogue,
  type ActorContext,
} from "@/modules/skills";

const routeLogger = logger.child({ component: "skills.catalogue.route" });

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

/**
 * Exports the current catalogue (or, given `?awardTypeId=`, one award type)
 * as a downloadable JSON file.
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const document = await exportCatalogue(await actor(), {
      awardTypeIds:
        request.nextUrl.searchParams.getAll("awardTypeId").length > 0
          ? request.nextUrl.searchParams.getAll("awardTypeId")
          : undefined,
    });

    const filename = `catalogus-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
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

/**
 * Imports a catalogue document uploaded as `multipart/form-data`, field
 * `file`. All-or-nothing (`importCatalogue`'s own transaction); a refusal
 * names exactly where in the document it happened.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Er is geen bestand meegestuurd (veld: file).",
            requestId,
            details: [],
          },
        },
        { status: 400, headers: { "x-request-id": requestId } },
      );
    }

    const text = await file.text();
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Het bestand is geen geldige JSON.",
            requestId,
            details: [],
          },
        },
        { status: 422, headers: { "x-request-id": requestId } },
      );
    }

    const result = await importCatalogue(await actor(), document);
    return NextResponse.json(
      { ok: true, result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof CatalogueImportError) {
      routeLogger.debug(
        { event: "skills.catalogue.import.rejected", path: error.path },
        "a catalogue import was rejected by validation",
      );
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: error.message,
            requestId,
            details: [{ field: error.path, issue: error.message }],
          },
        },
        { status: 422, headers: { "x-request-id": requestId } },
      );
    }
    return (
      deniedResponse(error, requestId) ?? toErrorResponse(error, requestId)
    );
  }
}
