/**
 * D-090's automatic payer default: "who is currently an active `GUARDIAN_OF`
 * relative of this pupil" for a `StudentProfile` id, in the picker's own flat
 * `{ id, label }` shape (mirrors `../relative-candidates/route.ts` and
 * `../student-candidates/route.ts`).
 *
 * REUSES THE PUBLISHED SERVICE, `listActiveGuardiansForStudent` (`@/modules/
 * people`, guarded on `people.read` at the SUBJECT). Nothing here decides who
 * may see whom or which candidate (if any) becomes a default — this route
 * only shapes the response; "exactly one ⇒ preselect" is the fees charge
 * form's own client-side decision, not a rule enforced here.
 *
 * `searchGuardianCandidates` is exported separately from `GET` for the same
 * reason as the other two candidate routes: it takes a plain `ActorContext`
 * and can be tested directly, while `GET` resolves the real session.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireEnrolledSession } from "@/lib/auth/session";
import { PermissionDeniedError } from "@/lib/authorization";
import {
  listActiveGuardiansForStudent,
  type ActorContext,
} from "@/modules/people";

export interface GuardianCandidatesResult {
  readonly ok: true;
  readonly results: {
    readonly id: string;
    readonly label: string;
  }[];
}

export interface GuardianCandidatesDenied {
  readonly ok: false;
  readonly permission: string;
}

/** The service call, mapped to the picker's flat `{ id, label }` shape. */
export async function searchGuardianCandidates(
  actor: ActorContext,
  studentProfileId: string,
): Promise<GuardianCandidatesResult | GuardianCandidatesDenied> {
  try {
    const guardians = await listActiveGuardiansForStudent(
      actor,
      studentProfileId,
    );
    return {
      ok: true,
      results: guardians.map((guardian) => ({
        id: guardian.id,
        label: `${guardian.familyName}, ${guardian.givenName}`,
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
  const studentProfileId =
    request.nextUrl.searchParams.get("studentProfileId") ?? "";

  if (studentProfileId === "") {
    return NextResponse.json({
      ok: true,
      results: [],
    } satisfies GuardianCandidatesResult);
  }

  const result = await searchGuardianCandidates(actor, studentProfileId);
  return NextResponse.json(result);
}
