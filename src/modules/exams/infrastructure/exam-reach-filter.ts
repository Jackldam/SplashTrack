/**
 * Translating a `Reach` into a `where` clause over `ExamCandidate` — the
 * `assessmentFilterForReach` shape (phase 2.3), applied a fourth time.
 *
 * ONLY `GROUPS` NARROWS, on the same recorded reasoning: the design states no
 * per-row rule for `ORGANIZATION`/`UNIT`/`COURSE`/`SESSION` over this table,
 * and narrowing `COURSE` would deny exactly the caller with the strongest
 * reason to read it — an exams manager confirming candidacies across a whole
 * course. `SELF` also returns `ALL`: it is the candidate's own record.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

export type ExamCandidateReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.ExamCandidateWhereInput }
  | { readonly kind: "DENIED" };

/** The `ExamCandidate` predicate this reach permits. */
export function examCandidateFilterForReach(
  reach: Reach,
): ExamCandidateReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // This group's rows only, on the D-145 rule 2 / `groupId` snapshot
    // precedent. `groupId` is NOT NULL, so a row never leaks in for lack of
    // a match.
    case "GROUPS":
      return {
        kind: "WHERE",
        where: { groupId: { in: [...variant.groupIds] } },
      };

    case "UNITS":
    case "COURSES":
    case "SESSIONS":
    case "SELF":
      return { kind: "ALL" };

    case "UNION": {
      const clauses: Prisma.ExamCandidateWhereInput[] = [];
      for (const member of variant.of) {
        const filter = examCandidateFilterForReach(member);
        if (filter.kind === "ALL") return { kind: "ALL" };
        if (filter.kind === "WHERE") clauses.push(filter.where);
      }
      if (clauses.length === 0) return { kind: "DENIED" };
      return { kind: "WHERE", where: { OR: clauses } };
    }
  }

  const exhaustive: never = variant;
  void exhaustive;
  return { kind: "DENIED" };
}
