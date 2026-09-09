/**
 * The "add relationship" picker's live search (mirrors the phase 2.2 guest
 * picker; see `../student-candidates/route.ts` and PR #19,
 * `git show e30775c`).
 *
 * REUSES THE EXISTING PEOPLE-LIST SEARCH, `listPeopleForPrincipal`
 * (`@/modules/people`, guarded on `people.read`) — the same reach-narrowed
 * read the people list page itself uses, not a new candidate filter: a
 * relative can be anyone the caller's `people.read` reach covers, not only a
 * pupil. Nothing here decides who may see whom; see
 * `tests/integration/people-scope-escape.test.ts` for that guarantee.
 *
 * `searchRelativeCandidates` is exported separately from `GET` for the same
 * reason as the student-candidates route: it takes a plain `ActorContext`
 * and can be tested directly, while `GET` resolves the real session.
 */
import { NextRequest, NextResponse } from "next/server";

import { formatCalendarDate } from "@/app/people/format";
import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import { listPeopleForPrincipal, type ActorContext } from "@/modules/people";

export interface RelativeCandidatesResult {
  readonly ok: true;
  readonly results: {
    readonly id: string;
    readonly label: string;
    readonly sublabel?: string;
  }[];
}

export interface RelativeCandidatesDenied {
  readonly ok: false;
  readonly permission: string;
}

/** The service call, mapped to the picker's flat `{ id, label, sublabel }` shape. */
export async function searchRelativeCandidates(
  actor: ActorContext,
  query: string,
): Promise<RelativeCandidatesResult | RelativeCandidatesDenied> {
  try {
    const candidates = await listPeopleForPrincipal(actor, { query });
    return {
      ok: true,
      results: candidates.map((candidate) => ({
        id: candidate.id,
        label: `${candidate.familyName}, ${candidate.givenName}`,
        sublabel: candidate.dateOfBirth
          ? formatCalendarDate(candidate.dateOfBirth)
          : undefined,
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

  const result = await searchRelativeCandidates(actor, query.trim());
  return NextResponse.json(result);
}
