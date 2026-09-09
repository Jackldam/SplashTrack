/**
 * Translating a `Reach` into a `where` clause over `Person` — D-031's "every
 * list query takes a `Reach` as a required repository argument", made concrete
 * for the first time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO ENFORCE: A LIST NEVER RETURNS MORE THAN A
 * PER-ROW CHECK WOULD ALLOW, AND NEVER LESS INFORMATIVELY.
 *
 * `06-delivery.md` §2.1: *"The **list** case is the one that must never be
 * dropped. Read and write are usually guarded explicitly; a list query silently
 * returning too much is the exact failure mode tenancy filtering had, one level
 * down (F-15)."* So every branch below MIRRORS the corresponding branch of
 * `coversResource(reach, { person })` — if the two ever disagree, either a
 * listable person fails their own detail page, or a person nobody may open
 * appears in a list. Both are defects; the second is the dangerous one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DENIED IS NOT THE SAME AS EMPTY, AND THAT IS THE WHOLE POINT
 *
 * A `GROUP`-scoped instructor holds no coverage of a bare `{ person }` at all
 * (§2.2: a group grant covers the group, its sessions and its members' group
 * relations — never the person record). The naive translation of that is "an
 * empty `where`", which renders as *"no people found"* — indistinguishable from
 * a club with no members, and it teaches the instructor that the screen is
 * broken rather than that they are not entitled to it.
 *
 * So the translation has THREE outcomes and not two, and `DENIED` is a real one
 * the caller turns into a `PermissionDeniedError`. Deny-by-default (§1.1 rule 2)
 * is about what happens on ambiguity; this is about telling the truth once the
 * answer is known.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXHAUSTIVE BY CONSTRUCTION
 *
 * The switch covers every `ReachVariant`, and the `never` at the end means
 * adding a scope type is a COMPILE ERROR here rather than a silent
 * fall-through — D-147's intended cost, paid the first time a repository
 * translates a reach.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-161: NO QUERY HARD-CODES THAT ONLY STAFF READ A RECORD
 *
 * The guardian portal is committed to v2 and *"no v1 decision may assume staff
 * are the only readers of a student's record"*. Nothing here asks whether the
 * reader is staff. `SELF` is a first-class branch, and a future `RELATED` reach
 * lands as one more `case` in this switch and one more `where` — not as a
 * rewrite of a query that had assumed its readers.
 */
import type { Prisma } from "@/lib/database";
import { reachVariant, type Reach } from "@/lib/authorization";

/**
 * How a reach narrows a query over `Person`.
 *
 * `ALL` rather than an empty `where`: "no filter" and "a filter that happens to
 * match everything" read identically at the call site and mean opposite things
 * if the reach is later narrowed.
 */
export type PersonReachFilter =
  | { readonly kind: "ALL" }
  | { readonly kind: "WHERE"; readonly where: Prisma.PersonWhereInput }
  | { readonly kind: "DENIED" };

/** The `Person` predicate this reach permits, or `DENIED`. */
export function personFilterForReach(reach: Reach): PersonReachFilter {
  const variant = reachVariant(reach);

  switch (variant.kind) {
    // The instance administrator's reach ends here, and it is the highest
    // authority that exists (§2.4).
    case "ORGANIZATION":
      return { kind: "ALL" };

    case "NONE":
      return { kind: "DENIED" };

    // §2.2 does not list `Person` under `UNIT` coverage, but §2.4's Member
    // Administrator is UNIT-scoped and administers people. The reading
    // `coversResource` implements — and this MUST match it — is that a bare
    // person resolves through their MEMBERSHIP unit, and that a person with no
    // membership is not reachable this way. A child taking lessons is the most
    // common person in the database and has no membership (§5.1); they are
    // addressed as `{ student }`, through their home unit, which is the
    // `students` half of this module and not a person query.
    case "UNITS":
      return {
        kind: "WHERE",
        where: {
          memberships: { some: { unitId: { in: [...variant.unitIds] } } },
        },
      };

    // D-146's closed set: one's own `Person`, explicitly granted, never matched
    // implicitly. This branch is also the axis D-161 forbids foreclosing — the
    // guardian portal adds readers, not a different query.
    case "SELF":
      return { kind: "WHERE", where: { id: variant.personId } };

    // A group grant reaches the group, its sessions and its members' GROUP
    // relations. A course grant reaches the course, its enrolments and its exam
    // sessions. A session grant reaches that roster, inside its window. None of
    // the three reaches a `Person` record, and saying so as DENIED rather than
    // as an empty result is this file's reason for existing.
    case "GROUPS":
    case "COURSES":
    case "SESSIONS":
      return { kind: "DENIED" };

    // Effective reach is the union of a principal's grants (§2.1), so a person
    // is listable if ANY member lists them. A union that contains an `ALL`
    // collapses to `ALL`; members that deny contribute nothing; a union in which
    // every member denies is itself a denial.
    case "UNION": {
      const clauses: Prisma.PersonWhereInput[] = [];
      for (const member of variant.of) {
        const filter = personFilterForReach(member);
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
