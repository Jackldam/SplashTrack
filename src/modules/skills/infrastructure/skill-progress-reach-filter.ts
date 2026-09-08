/**
 * Translating a `Reach` into a `where` clause over `SkillProgress` — the same
 * job `courseFilterForReach` and `groupFilterForReach` do for their tables,
 * for the one row-level narrowing Jack asked for in the phase 2.1 follow-up
 * (report §1.5): a `GROUP`-scoped reach's `skills.read` must return only the
 * rows this table's `groupId` snapshot ties to a group it holds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY `GROUPS` NARROWS. EVERY OTHER VARIANT KEEPS THE EXISTING FULL-HISTORY
 * BEHAVIOUR, DELIBERATELY.
 *
 * `getSkillProgressForStudent` guards `{ student }` and, until now, returned
 * every row once that gate cleared — the report's own §1.5 records why:
 * `SkillProgress` had no `groupId`/`courseId` to narrow by, and routing
 * narrowing through the optional `sessionId` would deny every `COURSE`-scoped
 * reach outright (`sessions`' `sessionFilterForReach` COURSES branch), making
 * an aftest assessor — whose whole reason to read this log is deciding
 * whether a child sits an exam — see nothing. That reasoning did not change;
 * only the `GROUP` case did, because Jack asked for it explicitly and the
 * new column exists to answer exactly that question. So `UNITS`, `COURSES`
 * and `SESSIONS` return `ALL` here, unchanged from before this column
 * existed — narrowing them too was never asked for, and doing it by
 * inventing a rule the design set does not state is the exact mistake this
 * module already declined to make once.
 *
 * `SELF` also returns `ALL`: it is the pupil's OWN record — `skills.read` is
 * in `SELF_PERMISSIONS` — and "my own group at the time" is not the
 * question; the whole history is.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

/**
 * How a reach narrows a query over `SkillProgress`.
 *
 * `ALL` rather than an empty `where`, on the `course`/`group` reach-filter
 * precedent: "no filter" and "a filter that happens to match everything"
 * mean different things the day this is narrowed further.
 */
export type SkillProgressReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.SkillProgressWhereInput }
  | { readonly kind: "DENIED" };

/** The `SkillProgress` predicate this reach permits. */
export function skillProgressFilterForReach(
  reach: Reach,
): SkillProgressReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // Jack's ask: this group's rows only. A row with no `groupId` (a
    // correction, an import, or a row written before this column existed)
    // never matches an `IN (...)` list, so it is excluded automatically —
    // not narrowed in, on purpose (see the file comment).
    case "GROUPS":
      return {
        kind: "WHERE",
        where: { groupId: { in: [...variant.groupIds] } },
      };

    // See the file comment: unchanged from the pre-`groupId` shape.
    case "UNITS":
    case "COURSES":
    case "SESSIONS":
    case "SELF":
      return { kind: "ALL" };

    case "UNION": {
      const clauses: Prisma.SkillProgressWhereInput[] = [];
      for (const member of variant.of) {
        const filter = skillProgressFilterForReach(member);
        if (filter.kind === "ALL") return { kind: "ALL" };
        if (filter.kind === "WHERE") clauses.push(filter.where);
      }
      if (clauses.length === 0) return { kind: "DENIED" };
      return { kind: "WHERE", where: { OR: clauses } };
    }
  }

  // Unreachable while every variant is handled. Present so that adding a
  // scope type fails to compile here instead of falling through to a filter
  // that returns everything.
  const exhaustive: never = variant;
  void exhaustive;
  return { kind: "DENIED" };
}
