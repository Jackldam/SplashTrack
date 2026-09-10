/**
 * Translating a `Reach` into a `where` clause over `Assessment` — the same
 * job `skillProgressFilterForReach` and `attendanceFilterForReach` do for
 * their tables, applied a third time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY `GROUPS` NARROWS. EVERY OTHER VARIANT SEES THE FULL HISTORY,
 * DELIBERATELY — the skills/attendance precedent (phase 2.1 report §1.5,
 * phase 2.2 report §1.3), applied here for the same recorded reasons: the
 * design states no per-row rule for `ORGANIZATION`/`UNIT`/`COURSE`/`SESSION`
 * over this table, and narrowing `COURSE` in particular would deny exactly
 * the caller with the strongest reason to read it — an `exams`-module
 * candidacy check reading `assessment` through its published service
 * (`01-domain-model.md` line ~130), which this phase's own report names as
 * the reason `COURSE` stays wide on `SkillProgress` too.
 *
 * `SELF` also returns `ALL`: it is the pupil's own record.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

/**
 * How a reach narrows a query over `Assessment`.
 *
 * `ALL` rather than an empty `where`, on the `skillProgressFilterForReach`
 * precedent: "no filter" and "a filter that happens to match everything"
 * mean different things the day this is narrowed further.
 */
export type AssessmentReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.AssessmentWhereInput }
  | { readonly kind: "DENIED" };

/** The `Assessment` predicate this reach permits. */
export function assessmentFilterForReach(reach: Reach): AssessmentReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // This group's rows only, on the D-145 rule 2 / `groupId` snapshot
    // precedent. A row with no matching `groupId` (there is none — the
    // column is NOT NULL, unlike `SkillProgress.groupId`) never leaks in.
    case "GROUPS":
      return {
        kind: "WHERE",
        where: { groupId: { in: [...variant.groupIds] } },
      };

    // See the file comment: unchanged from the `SkillProgress`/
    // `AttendanceEvent` shape.
    case "UNITS":
    case "COURSES":
    case "SESSIONS":
    case "SELF":
      return { kind: "ALL" };

    case "UNION": {
      const clauses: Prisma.AssessmentWhereInput[] = [];
      for (const member of variant.of) {
        const filter = assessmentFilterForReach(member);
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
