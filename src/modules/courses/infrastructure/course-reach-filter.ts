/**
 * Translating a `Reach` into a `where` clause over `Course` — the same job
 * `personFilterForReach` and `groupFilterForReach` do for their tables, against
 * a different coverage row of §2.2's matrix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY BRANCH MIRRORS `coversResource(reach, { course })`
 *
 * If the two disagree, either a listable course fails its own detail page, or a
 * course nobody may open appears in a list. Both are defects; the second is the
 * dangerous one, and it is the exact failure `06-delivery.md` §2.1 says a list
 * query must never have. `courses-scope-escape.test.ts` asserts the two agree
 * on the same rows rather than trusting that they were written to match.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A `UNIT` GRANT DOES NOT COVER A COURSE, AND THAT IS THE WHOLE OF D-170
 *
 * §2.1 places `COURSE` **across** units — *"one course across groups"* — so a
 * unit grant never covers the course OBJECT, however many of its groups sit in
 * that unit. This is the branch a scope-type RANKING gets wrong: `COURSE` looks
 * "narrower" than `UNIT`, a Location Manager at Zuidbad passes every check, and
 * their reach quietly extends to Diploma B at Noordbad. There is no ranking, so
 * this returns `DENIED`, and `covers-resource.ts`'s `UNITS`/`course` branch
 * says the same thing from the other side.
 *
 * A `UNIT`-scoped principal still reaches the GROUPS in their unit — that is
 * `groupFilterForReach`'s job and a different question.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

/**
 * How a reach narrows a query over `Course`.
 *
 * `ALL` rather than an empty `where`: "no filter" and "a filter that happens to
 * match everything" read identically at the call site and mean opposite things
 * the day the reach is narrowed. `group-reach-filter.ts` learned that the hard
 * way — `{ group: {} }` is not a no-op in Prisma as a relation filter.
 */
export type CourseReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.CourseWhereInput }
  | { readonly kind: "DENIED" };

/** The `Course` predicate this reach permits, or `DENIED`. */
export function courseFilterForReach(reach: Reach): CourseReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // The course itself — §2.2's "that course, its levels, its enrolments".
    case "COURSES":
      return { kind: "WHERE", where: { id: { in: [...variant.courseIds] } } };

    // See the file comment: a course runs ACROSS units, so a unit grant never
    // covers the course object. D-170's cross-unit case.
    case "UNITS":
      return { kind: "DENIED" };

    // Upward, and §6.1 forbids upward: a GROUP-scoped instructor reaches their
    // group, its sessions and its pupils' group relations — never the course
    // the group is taught under, which spans groups they have no relationship
    // with. `covers-resource.ts`'s GROUPS/course branch agrees.
    case "GROUPS":
      return { kind: "DENIED" };

    // §2.2 is explicit that a SESSION grant reaches "that one session's roster
    // only ... nothing else, NOT THE COURSE, not the students' other records".
    // Named in the design because COURSE scope over-grants every one of the
    // four cases D-068 generalises.
    case "SESSIONS":
      return { kind: "DENIED" };

    // A course is not anybody's own record. D-146's SELF set is a closed list
    // of one's own person, profile, progress, attendance and awards.
    case "SELF":
      return { kind: "DENIED" };

    case "UNION": {
      const clauses: Prisma.CourseWhereInput[] = [];
      for (const member of variant.of) {
        const filter = courseFilterForReach(member);
        if (filter.kind === "ALL") return { kind: "ALL" };
        if (filter.kind === "WHERE") clauses.push(filter.where);
      }
      if (clauses.length === 0) return { kind: "DENIED" };
      return { kind: "WHERE", where: { OR: clauses } };
    }
  }

  // Unreachable while every variant is handled. Present so that adding a scope
  // type fails to compile here instead of falling through to a filter that
  // returns everything.
  const exhaustive: never = variant;
  void exhaustive;
  return { kind: "DENIED" };
}
