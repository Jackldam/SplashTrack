/**
 * Translating a `Reach` into a `where` clause over `ScheduledSession`.
 *
 * Every branch MIRRORS `coversResource(reach, { session })`. If the two
 * disagree, either a listable lesson fails its own detail page, or a lesson
 * nobody may open appears in a schedule — and the second is the dangerous one
 * `06-delivery.md` §2.1 says a list query must never have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE `SESSIONS` BRANCH CARRIES A TIME WINDOW, AND IT IS A REAL PREDICATE
 *
 * A `SESSION` grant is valid for a bounded window (D-144 makes `validUntil`
 * schema-mandatory for it; D-170 derives the ceiling from the session's own
 * date). `coversResource` re-checks that window on every call, which is what
 * keeps a `Reach` honest when it is held across a boundary — cached in a request
 * context, passed into a job. This filter does the same rather than trusting
 * that `resolveReach` was called a moment ago: `06-delivery.md` §2.1 requires
 * the escape test to assert refusal "outside the session ... AND outside its
 * time window", so the window is asserted here too.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

export type SessionReachFilter =
  | { readonly kind: "ALL" }
  | {
      readonly kind: "WHERE";
      readonly where: Prisma.ScheduledSessionWhereInput;
    }
  | { readonly kind: "DENIED" };

/** The `ScheduledSession` predicate this reach permits at `at`, or `DENIED`. */
export function sessionFilterForReach(
  reach: Reach,
  at: Date,
): SessionReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // §2.2: a unit covers every session directly beneath it — reached through
    // the session's GROUP, because §3.6 gives the session no unit of its own.
    // FLAT (D-121): no descendant walk, ever, in v1.
    case "UNITS":
      return {
        kind: "WHERE",
        where: { group: { unitId: { in: [...variant.unitIds] } } },
      };

    // A group covers its scheduled sessions. The group ids in this reach have
    // already passed D-145 rule 1 — `resolveReach` refused to admit any group
    // the holder is not currently assigned to instruct — so this is a plain id
    // test and NOT a second live check. One home per rule (D-147).
    case "GROUPS":
      return {
        kind: "WHERE",
        where: { groupId: { in: [...variant.groupIds] } },
      };

    // That one session, inside the grant's own window. Outside it, the grant
    // covers nothing at all — not even the session it names.
    case "SESSIONS": {
      if (at < variant.window.from || at >= variant.window.until) {
        return { kind: "DENIED" };
      }
      return { kind: "WHERE", where: { id: { in: [...variant.sessionIds] } } };
    }

    // A course covers its exam sessions and its enrolments (§2.2). Answering
    // "which scheduled sessions belong to this course" needs `sessionsOfCourse`,
    // which `courses` owns and has not registered because it does not exist.
    // DENIED is honest today and it is the SAFE direction.
    case "COURSES":
      return { kind: "DENIED" };

    // D-146's SELF set is one's own person, profile, progress, attendance and
    // awards. A lesson is not one of them: a pupil's own timetable is a v2
    // guardian-portal surface (D-161), and it lands as a branch here rather than
    // as a rewrite — nothing in this file assumes its readers are staff.
    case "SELF":
      return { kind: "DENIED" };

    case "UNION": {
      const clauses: Prisma.ScheduledSessionWhereInput[] = [];
      for (const member of variant.of) {
        const filter = sessionFilterForReach(member, at);
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
