/**
 * `coversResource()` — the coverage predicate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE DESIGN SAYS, AND WHAT IT LEAVES OPEN
 *
 * §2.6.1 uses the name as if it existed — *"`coversResource()` and
 * `resolveReach()` already compute, for a `(permission, scopeType, scopeId)`
 * grant, the set of resources it reaches"* — and no chapter defines its
 * signature, its arguments or its return. §2.2 gives the coverage MATRIX, which
 * is its body. This file is the definition, and
 * `docs/build/phase-0.4b-reach-and-retention-report.md` §3 records the choice.
 *
 * **The signature: `coversResource(reach, ref, at) => Promise<boolean>`.**
 *
 * Over a `Reach`, not over a raw `(permission, scopeType, scopeId)` tuple, for
 * one reason that decides it: a `Reach` is the only authority-produced
 * representation of what a grant covers (D-147). A predicate that took the raw
 * tuple would be a second path to the same answer, reachable without
 * `resolveReach` and therefore without its live-relation rules and its expiry
 * check — exactly the "widen it temporarily" escape the opaque type exists to
 * close. So `requirePermission` is `coversResource(await resolveReach(...))`,
 * and there is no other way to ask.
 *
 * Asynchronous, because coverage is **evaluated live** (D-145): the answer
 * depends on relations that change between one call and the next, and a
 * synchronous signature would have forced them to be captured at grant time,
 * which is the failure F-114 describes.
 *
 * `at` is explicit rather than `new Date()` per call, so one request evaluates
 * every check against one instant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PER RELATION, NOT PER ENTITY (D-145 rule 2)
 *
 * Scope covers RELATIONS, not the `Person` node. A `GROUP`-scoped
 * `students.read` returns identity basics plus **this group's** progress and
 * attendance. It does not return the student's other groups, attendance at
 * other locations, other enrolments, exam history or guardian relationships.
 *
 * That is a rule about the FIELDS a repository returns, and this predicate
 * cannot enforce it — it answers "is this row reachable at all". The field-level
 * half belongs to each repository and is asserted by the per-module
 * scope-escape suite, which `06-delivery.md` §2.1 requires to assert on the
 * **fields returned**, not only on whether the row was reachable. Saying so here
 * is the point: a green `coversResource` is necessary and not sufficient.
 */
import { logger } from "@/lib/logging";

import { reachVariant, type Reach } from "./reach";
import {
  normaliseResourceRef,
  type NormalisedResourceRef,
  type ResourceRef,
} from "./scope";
import {
  ScopeRelationUnavailableError,
  scopeRelations,
} from "./scope-relations";

/**
 * Does this reach cover this resource, right now?
 *
 * Deny by default on ANY failure (§1.1 rule 2), including a relation nobody
 * registered and a database that is unreachable. Every derived rule below is a
 * POSITIVE membership test, so a missing referent — a dangling `scopeId`, a
 * deleted group — fails it rather than passing it.
 */
export async function coversResource(
  reach: Reach,
  ref: ResourceRef,
  at: Date = new Date(),
): Promise<boolean> {
  let normalised: NormalisedResourceRef;
  try {
    normalised = normaliseResourceRef(ref);
  } catch (error) {
    logger.error(
      { component: "authorization", event: "coverage.invalid_ref", err: error },
      "malformed resource reference — denying",
    );
    return false;
  }

  try {
    return await covers(reach, normalised, at);
  } catch (error) {
    logger[error instanceof ScopeRelationUnavailableError ? "warn" : "error"](
      {
        component: "authorization",
        event: "coverage.evaluation_failed",
        resourceKind: normalised.kind,
        err: error,
      },
      "coverage could not be evaluated — denying",
    );
    return false;
  }
}

async function covers(
  reach: Reach,
  ref: NormalisedResourceRef,
  at: Date,
): Promise<boolean> {
  const variant = reachVariant(reach);
  const relations = scopeRelations();

  switch (variant.kind) {
    // Every resource in the installation. The instance administrator is the
    // highest authority that exists and their reach ends here (§2.4).
    case "ORGANIZATION":
      return true;

    case "NONE":
      return false;

    // A union is covered if ANY member covers it — effective reach is the union
    // of a principal's grants (§2.1). This is also why the NARROWING rules of
    // §2.2 are part of coverage itself: a union can never be made smaller by a
    // rule stated elsewhere.
    case "UNION": {
      for (const member of variant.of) {
        if (await covers(member, ref, at)) return true;
      }
      return false;
    }

    // ── UNIT — that unit only. No descendant walk, ever, in v1 (D-121). ──────
    case "UNITS": {
      const units = new Set(variant.unitIds);
      switch (ref.kind) {
        case "organization":
          return false;
        case "unit":
          return units.has(ref.id);
        case "group": {
          const unit = await relations.unitOfGroup(ref.id);
          return unit !== null && units.has(unit);
        }
        case "session": {
          const group = await relations.groupOfSession(ref.id);
          if (group === null) return false;
          const unit = await relations.unitOfGroup(group);
          return unit !== null && units.has(unit);
        }
        case "student": {
          // The HOME unit governs the student's profile (D-145). A child
          // registered at Zuidbad attending a summer course at Noordbad is NOT
          // reachable by Noordbad's Location Manager as a profile — only that
          // group's attendance and progress are, through the `group` case above.
          const home = await relations.homeUnitOfStudent(ref.id);
          return home !== null && units.has(home);
        }
        case "person": {
          // §2.2 does not list `Person` under UNIT coverage; §2.4's Member
          // Administrator is UNIT-scoped and administers people. Resolved
          // through the person's MEMBERSHIP unit — see `unitOfPerson` for the
          // full reasoning and for why a child with no membership is addressed
          // as `{ student }` instead.
          const unit = await relations.unitOfPerson(ref.id);
          return unit !== null && units.has(unit);
        }
        case "course":
          // A course runs ACROSS units (§2.1: "one course across groups"), so a
          // unit grant never covers the course object itself. This is the case
          // a scope-type RANKING waves through — `COURSE` looks "narrower" than
          // `UNIT`, and D-170 exists because it is not.
          return false;
      }
      break;
    }

    // ── GROUP — that group, its sessions, and its members' group relations ───
    case "GROUPS": {
      const groups = new Set(variant.groupIds);
      switch (ref.kind) {
        case "group":
          return groups.has(ref.id);
        case "session": {
          const group = await relations.groupOfSession(ref.id);
          return group !== null && groups.has(group);
        }
        case "student": {
          // The holder's InstructorAssignment was already required to be active
          // for this group id to be in the reach at all (`resolveReach`). The
          // other half of D-145 rule 1 is here: the membership must be active
          // NOW. A lapsed membership row grants nothing — which is what stops
          // every instructor who ever taught a child from keeping read access
          // to them permanently (F-114).
          for (const groupId of groups) {
            if (
              await relations.isActiveGroupMember({
                groupId,
                studentProfileId: ref.id,
                at,
              })
            ) {
              return true;
            }
          }
          return false;
        }
        case "organization":
        case "unit":
        case "course":
        case "person":
          // Not the whole student record, and never upward: a GROUP-scoped role
          // cannot reach the unit (§6.1). A bare `Person` is addressed through
          // `{ student }`, which is the relation a group grant actually has.
          return false;
      }
      break;
    }

    // ── COURSE — the course, its enrolments, and ALL its exam sessions ───────
    case "COURSES": {
      const courses = new Set(variant.courseIds);
      switch (ref.kind) {
        case "course":
          return courses.has(ref.id);
        case "session": {
          for (const courseId of courses) {
            const sessions = await relations.sessionsOfCourse(courseId);
            if (sessions.includes(ref.id)) return true;
          }
          return false;
        }
        case "group": {
          for (const courseId of courses) {
            const groups = await relations.groupsOfCourse(courseId);
            if (groups.includes(ref.id)) return true;
          }
          return false;
        }
        case "student": {
          for (const courseId of courses) {
            if (
              await relations.isEnrolledInCourse({
                courseId,
                studentProfileId: ref.id,
                at,
              })
            ) {
              return true;
            }
          }
          return false;
        }
        case "organization":
        case "unit":
        case "person":
          return false;
      }
      break;
    }

    // ── SESSION — that one session's roster only, inside the window ──────────
    case "SESSIONS": {
      // The window is the grant's own validity (D-144). `resolveReach` already
      // dropped grants outside it at resolution time; re-checking here is what
      // makes a `Reach` held across a boundary — cached in a request context,
      // passed into a long-running job — still honest. `06-delivery.md` §2.1
      // requires the escape test to assert "outside the session ... AND outside
      // its time window", so the window is a real predicate, not a label.
      if (at < variant.window.from || at >= variant.window.until) return false;
      const sessions = new Set(variant.sessionIds);
      switch (ref.kind) {
        case "session":
          return sessions.has(ref.id);
        case "student": {
          // Resolved from the roster AT CHECK TIME (D-068), so a student added
          // to or removed from it changes reach immediately. This is what
          // carries the make-up guest, the substitute and the aftest assessor
          // (D-179) — the receiving instructor can see the child in front of
          // them without an administrator minting a grant at 16:55.
          for (const sessionId of sessions) {
            if (
              await relations.isOnSessionRoster({
                sessionId,
                studentProfileId: ref.id,
                at,
              })
            ) {
              return true;
            }
          }
          return false;
        }
        case "organization":
        case "unit":
        case "group":
        case "course":
        case "person":
          // "Nothing else, not the course, not the students' other records"
          // (§2.2). `COURSE` scope over-grants every one of the four cases
          // D-068 generalises — an assessor would gain every future aftest and
          // exam of that course, on exactly the records that matter most.
          return false;
      }
      break;
    }

    // ── SELF — the holder's own records, never by implication (D-146) ────────
    case "SELF": {
      switch (ref.kind) {
        case "person":
          return ref.id === variant.personId;
        case "student": {
          const person = await relations.personOfStudent(ref.id);
          return person !== null && person === variant.personId;
        }
        case "organization":
        case "unit":
        case "group":
        case "course":
        case "session":
          // A guardian reading a child's record is not SELF and has no scope in
          // v1 (D-122, OD-5). Nothing about another person, ever.
          return false;
      }
      break;
    }
  }

  // Unreachable while every variant handles every reference kind. Present so
  // adding a scope type is a COMPILE error here (the `never` below) rather than
  // a silent fall-through that returns a boolean.
  const exhaustive: never = variant as never;
  void exhaustive;
  return false;
}
