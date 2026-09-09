/**
 * Translating a `Reach` into a `where` clause over `StudentProfile` — the
 * `personFilterForReach` job one entity over, built for the guest picker on
 * the lesson screen (phase 2.2 decision round, item 4's follow-up: an
 * instructor picks a pupil by NAME, so something must answer "which pupils
 * may this caller see at all").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY BRANCH MIRRORS `coversResource(reach, { student })`, OR NARROWS IT
 *
 * The rule from `person-reach-filter.ts` applies unchanged: a list never
 * returns more than a per-row check would allow. Two branches deliberately
 * return LESS, and say so:
 *
 *   - `SESSIONS` covers a student through the roster's derived half too (an
 *     active member of the session's group on the LESSON's date —
 *     `isOnSessionRoster`). This predicate takes only the EXPLICIT half
 *     (`SessionRosterEntry` rows): expressing "member on each session's own
 *     `occursOn`" as one `where` clause means a per-session subquery this
 *     narrow feature does not need. Under-approximation is the safe
 *     direction — a derived roster member the picker misses is already ON
 *     the roster, which for a guest picker is exactly the pupil nobody needs
 *     to add.
 *   - No branch widens. In particular there is no "the whole organisation,
 *     searchable" fallback: a caller whose reach is `NONE` gets `DENIED`,
 *     and the screen says so instead of rendering an empty list
 *     (`person-reach-filter.ts`'s three-outcome reasoning, unchanged).
 *
 * The design set states no explicit rule for "which pupils may populate a
 * picker" — this file chooses the cautious side (exactly the caller's
 * `students.read` reach, live rules included) and the phase 2.2 report
 * flags the choice.
 */
import { reachVariant, type Reach } from "@/lib/authorization";
import type { Prisma } from "@/lib/database";

/** How a reach narrows a query over `StudentProfile`. */
export type StudentCandidateReachFilter =
  | { readonly kind: "ALL" }
  | {
      readonly kind: "WHERE";
      readonly where: Prisma.StudentProfileWhereInput;
    }
  | { readonly kind: "DENIED" };

/** The `StudentProfile` predicate this reach permits, evaluated at `at`. */
export function studentCandidateFilterForReach(
  reach: Reach,
  at: Date,
): StudentCandidateReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // The HOME unit governs the student's profile (D-145; `coversResource`'s
    // own `student` case under `UNITS`).
    case "UNITS":
      return {
        kind: "WHERE",
        where: { unitId: { in: [...variant.unitIds] } },
      };

    // D-145 rule 1's second half, as a predicate: the membership must be
    // active NOW (the holder's InstructorAssignment being active is what put
    // the group id in the reach at all — `resolveReach`).
    case "GROUPS":
      return {
        kind: "WHERE",
        where: {
          groupMemberships: {
            some: {
              groupId: { in: [...variant.groupIds] },
              fromDate: { lte: at },
              OR: [{ toDate: null }, { toDate: { gt: at } }],
            },
          },
        },
      };

    // `isEnrolledInCourse`'s predicate, verbatim.
    case "COURSES":
      return {
        kind: "WHERE",
        where: {
          enrolments: {
            some: {
              courseId: { in: [...variant.courseIds] },
              startedAt: { lte: at },
              OR: [{ endedAt: null }, { endedAt: { gt: at } }],
            },
          },
        },
      };

    // The grant's own validity window is a real predicate here, exactly as
    // it is in `coversResource` — and only the EXPLICIT roster half is
    // matched; see the file comment.
    case "SESSIONS": {
      if (at < variant.window.from || at >= variant.window.until) {
        return { kind: "DENIED" };
      }
      return {
        kind: "WHERE",
        where: {
          rosterEntries: {
            some: { sessionId: { in: [...variant.sessionIds] } },
          },
        },
      };
    }

    // Own profile only (D-146's enumerated set includes `students.read` on
    // one's own record and nothing about anybody else).
    case "SELF":
      return { kind: "WHERE", where: { personId: variant.personId } };

    case "UNION": {
      const clauses: Prisma.StudentProfileWhereInput[] = [];
      for (const member of variant.of) {
        const filter = studentCandidateFilterForReach(member, at);
        if (filter.kind === "ALL") return { kind: "ALL" };
        if (filter.kind === "WHERE") clauses.push(filter.where);
      }
      if (clauses.length === 0) return { kind: "DENIED" };
      return { kind: "WHERE", where: { OR: clauses } };
    }
  }

  // Adding a scope type fails to compile here rather than falling through to
  // a filter that returns everything.
  const exhaustive: never = variant;
  void exhaustive;
  return { kind: "DENIED" };
}
