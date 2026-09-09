/**
 * The guest picker's live search (phase 2.2, replacing the two-step
 * GET-search-then-`<select>` flow — `git show 60529c6`).
 *
 * REUSES THE EXISTING SCOPE-CORRECT SERVICE, `listStudentCandidatesForPrincipal`
 * (`@/modules/people`, guarded on `students.read`, narrowed by
 * `student-candidate-filter.ts`). Nothing here decides who may see whom —
 * this route is exactly the read the old server-rendered search performed,
 * called from a fetch instead of a page render. See
 * `tests/integration/student-candidates-scope.test.ts` for the scope
 * guarantee itself, unchanged.
 *
 * `searchStudentCandidates` is exported separately from `GET` so it can be
 * exercised directly against a real `ActorContext`, the same way every other
 * suite in this repo tests a service — `GET` itself only resolves the
 * session (`requireEnrolledSession`, which reads Next's per-request async
 * storage and so cannot run outside a real request) and shapes the response.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import {
  listStudentCandidatesForPrincipal,
  type ActorContext,
} from "@/modules/people";

export interface StudentCandidatesResult {
  readonly ok: true;
  readonly results: {
    readonly id: string;
    readonly label: string;
    readonly sublabel: string;
  }[];
}

export interface StudentCandidatesDenied {
  readonly ok: false;
  readonly permission: string;
}

/** The service call, mapped to the picker's flat `{ id, label, sublabel }` shape. */
export async function searchStudentCandidates(
  actor: ActorContext,
  query: string,
): Promise<StudentCandidatesResult | StudentCandidatesDenied> {
  try {
    const candidates = await listStudentCandidatesForPrincipal(actor, {
      query,
    });
    return {
      ok: true,
      results: candidates.map((candidate) => ({
        id: candidate.studentProfileId,
        label: `${candidate.familyName}, ${candidate.givenName}`,
        sublabel: candidate.studentNumber,
      })),
    };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { ok: false, permission: error.permission };
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const session = await requireEnrolledSession();
  const actor: ActorContext = {
    principal: { personId: session.person.id },
    at: new Date(),
  };
  const query = request.nextUrl.searchParams.get("q") ?? "";

  const result = await searchStudentCandidates(actor, query.trim());
  return NextResponse.json(result);
}
