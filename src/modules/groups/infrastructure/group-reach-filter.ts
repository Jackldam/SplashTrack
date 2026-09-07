/**
 * Translating a `Reach` into a `where` clause over `Group` — the same job
 * `personFilterForReach` does for `Person`, against a different coverage row of
 * §2.2's matrix.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY BRANCH MIRRORS `coversResource(reach, { group })`
 *
 * If the two disagree, either a listable group fails its own detail page, or a
 * group nobody may open appears in a list. Both are defects; the second is the
 * dangerous one, and it is the exact failure `06-delivery.md` §2.1 says a list
 * query must never have. `groups-scope-escape.test.ts` asserts the two agree on
 * the same rows rather than trusting that they were written to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE `GROUPS` BRANCH IS **NOT** A LIVE CHECK, AND MUST NOT BE
 *
 * `variant.groupIds` already went through D-145 rule 1: `resolveReach` refused
 * to put a group id in a `GROUPS` reach unless the holder had an ACTIVE
 * `InstructorAssignment` for it at that instant. So filtering on `id IN (...)`
 * here is filtering on an answer the authority already computed live — and
 * re-deriving it with a second query against `InstructorAssignment` would be a
 * SECOND coverage rule, reachable without `resolveReach`, which is what D-147's
 * opaque type exists to prevent. One home per rule.
 *
 * The consequence is the one the definition of done names: an instructor whose
 * assignment has ended resolves to `NONE`, not to `GROUPS([])` — so this
 * function is never even reached, and the caller reports a DENIAL rather than an
 * empty list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ASYNCHRONOUS, AS OF PHASE 2.0
 *
 * The `COURSES` branch needs to know which groups a course has, and that answer
 * belongs to the `courses` module — `groupsOfCourse`, registered through
 * `configureScopeRelations`. Asking the REGISTRY rather than writing a second
 * `where` clause over `CourseLevel` here is the whole point: `coversResource`'s
 * `COURSES`/`group` branch already asks the same relation, so the predicate and
 * the filter cannot disagree about what a course contains. A hand-written
 * traversal beside it would be a second home for one rule (D-134), and the two
 * homes would be a list returning a group its own detail page refuses — the
 * defect this file's header opens with.
 *
 * The relation is asynchronous because coverage is evaluated LIVE (D-145), so
 * this is too. Every caller was already async.
 */
import {
  reachVariant,
  ScopeRelationUnavailableError,
  scopeRelations,
  type Reach,
} from "@/lib/authorization";
import type { Prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

/**
 * How a reach narrows a query over `Group`.
 *
 * `ALL` rather than an empty `where`: "no filter" and "a filter that happens to
 * match everything" read identically at the call site and mean opposite things
 * the day the reach is narrowed.
 */
export type GroupReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.GroupWhereInput }
  | { readonly kind: "DENIED" };

/** The `Group` predicate this reach permits, or `DENIED`. */
export async function groupFilterForReach(
  reach: Reach,
): Promise<GroupReachFilter> {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // §2.2: a unit covers "every group, session, student and exam session
    // directly beneath it". FLAT — no descendant walk, ever, in v1 (D-121).
    case "UNITS":
      return {
        kind: "WHERE",
        where: { unitId: { in: [...variant.unitIds] } },
      };

    // The group itself. See the file comment for why this is an id test and not
    // a second live check.
    case "GROUPS":
      return { kind: "WHERE", where: { id: { in: [...variant.groupIds] } } };

    // A course covers its groups (§2.2), through `Group -> CourseLevel ->
    // Course`. The ids come from `groupsOfCourse`, which the `courses` module
    // owns and registered in phase 2.0 — the same relation
    // `coversResource(reach, { group })` asks, so the two cannot disagree.
    //
    // A group with no `courseLevelId` belongs to no course and appears in no
    // answer, which is the safe direction: the column is nullable and was NOT
    // backfilled, so "we do not know this group's level" reads as "no COURSE
    // grant reaches it" rather than as a guess.
    case "COURSES": {
      const groupIds = new Set<string>();
      try {
        for (const courseId of variant.courseIds) {
          for (const groupId of await scopeRelations().groupsOfCourse(
            courseId,
          )) {
            groupIds.add(groupId);
          }
        }
      } catch (error) {
        // Deny by default on ANY failure (§1.1 rule 2), and say so loudly —
        // "the courses module is not registered" and "this course has no
        // groups" must be distinguishable to whoever reads the log.
        logger[
          error instanceof ScopeRelationUnavailableError ? "warn" : "error"
        ](
          {
            component: "authorization",
            event: "group_filter.course_relation_unavailable",
            err: error,
          },
          "COURSE reach over groups denied — groupsOfCourse could not be read",
        );
        return { kind: "DENIED" };
      }
      // An empty course reaches no group. `DENIED` and not `WHERE id IN ()`,
      // because the `ALL`/`WHERE`/`DENIED` split exists precisely so that "no
      // groups" is never spelled as an empty predicate somebody later reads as
      // "no filter".
      if (groupIds.size === 0) return { kind: "DENIED" };
      return { kind: "WHERE", where: { id: { in: [...groupIds] } } };
    }

    // §2.2 is explicit that a SESSION grant reaches "that one session's roster
    // only ... nothing else, not the course, not the students' other records".
    // The group a session belongs to is one of those "else"s: a make-up guest's
    // instructor may see the lesson, never the group's whole membership list.
    case "SESSIONS":
      return { kind: "DENIED" };

    // A group is not anybody's own record. D-146's SELF set is a closed list of
    // one's own person, profile, progress, attendance and awards.
    case "SELF":
      return { kind: "DENIED" };

    case "UNION": {
      const clauses: Prisma.GroupWhereInput[] = [];
      for (const member of variant.of) {
        const filter = await groupFilterForReach(member);
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
