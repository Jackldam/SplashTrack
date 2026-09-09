/**
 * Translating a `Reach` into a `where` clause over `AttendanceEvent` — the
 * `skillProgressFilterForReach` shape, applied to the table it was always
 * going to reach next (the phase 2.1 follow-up built the `GROUP` narrowing
 * for `SkillProgress`; D-145 rule 2 names *"this group's progress AND
 * attendance"* in one breath, so this module ships with it from day one).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONLY `GROUPS` NARROWS. EVERY OTHER VARIANT SEES THE FULL HISTORY,
 * DELIBERATELY — THE SAME STANCE, FOR THE SAME REASONS.
 *
 * `getAttendanceForStudent` guards `{ student }` first; this filter then
 * narrows per row. The non-narrowed variants are not an oversight:
 *
 *   - `ORGANIZATION` sees everything by definition.
 *   - `UNITS`, `COURSES`, `SESSIONS`: the design states no per-row rule for
 *     them over this table, and the skills reach filter's file comment
 *     records why inventing one is the mistake that module already declined —
 *     in particular, routing `COURSES` through `sessions`'
 *     `sessionFilterForReach` would deny it outright (that filter's own
 *     `COURSES` branch is a deliberate `DENIED`). Flagged in the phase 2.2
 *     report, not decided here.
 *   - `SELF` is the pupil's OWN record (`attendance.read` is in
 *     `SELF_PERMISSIONS` — D-146's "own attendance"), and "my own group at
 *     the time" is not the question; the whole history is.
 *
 * One difference from the skills filter, and it is a simplification:
 * `AttendanceEvent.groupId` is NOT NULL (every event has a session, every
 * session has a group), so the "row with no group is invisible to `GROUP`"
 * rule has nothing to apply to here.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

/**
 * How a reach narrows a query over `AttendanceEvent`.
 *
 * `ALL` rather than an empty `where`, on the same precedent as every other
 * reach filter: "no filter" and "a filter that happens to match everything"
 * mean different things the day this is narrowed further.
 */
export type AttendanceReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.AttendanceEventWhereInput }
  | { readonly kind: "DENIED" };

/** The `AttendanceEvent` predicate this reach permits. */
export function attendanceFilterForReach(reach: Reach): AttendanceReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // D-145 rule 2: this group's attendance only.
    case "GROUPS":
      return {
        kind: "WHERE",
        where: { groupId: { in: [...variant.groupIds] } },
      };

    // See the file comment: stated, not forgotten.
    case "UNITS":
    case "COURSES":
    case "SESSIONS":
    case "SELF":
      return { kind: "ALL" };

    case "UNION": {
      const clauses: Prisma.AttendanceEventWhereInput[] = [];
      for (const member of variant.of) {
        const filter = attendanceFilterForReach(member);
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
