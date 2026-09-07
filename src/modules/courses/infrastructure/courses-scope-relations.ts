/**
 * The `ScopeRelations` this module OWNS — the last four of the thirteen, and
 * the ones every other module has been denying on since phase 0.4b.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGES THE DAY THESE ARE REGISTERED
 *
 * `COURSE` is the one scope type whose coverage rules were fully written and
 * fully inert. `covers-resource.ts`'s `COURSES` branch has always had a
 * `session`, a `group` and a `student` case; all three called relations nobody
 * had implemented, so every one of them threw, was converted into a DENIAL, and
 * logged a warning. `group-reach-filter.ts` says so in as many words —
 * *"DENIED is the honest answer today ... When `courses` lands, this branch
 * becomes a filter"*. This file is that landing.
 *
 * Registering them makes `COURSE` grants mean something for the first time, so
 * `courses-scope-escape.test.ts` asserts each of the four against real rows —
 * §2.1 requires the per-module suite to include a `COURSE`-scoped principal
 * *specifically*, named as the case a type-ranking implementation passes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO OF THE FOUR ANSWER "NOTHING", AND THAT IS AN ANSWER
 *
 * `sessionsOfCourse` and `courseEndDate` return the empty set and null. Neither
 * is a stub: an unregistered relation THROWS and says "the module that owns
 * this table has not registered one", which would now be false — the module
 * exists. What is true is narrower and is stated on each of them below: this
 * installation has no exam sessions because `ExamSession` belongs to the
 * unbuilt `exams` module, and a `Course` carries no end date because §3.2 gives
 * it none. Both refuse rather than widen, which is the direction every rule in
 * the authorization layer fails toward.
 */
import type { ScopeRelations } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { groupIdsForCourseLevels } from "@/modules/groups";

export const coursesScopeRelations: Partial<ScopeRelations> = {
  /**
   * Is this pupil enrolled in that course right now? §2.2 gives `COURSE`
   * coverage as *"that course, its levels, its **enrolments**, and all its exam
   * sessions"* — this is the enrolments half.
   *
   * EVALUATED LIVE, at query time, never from a value captured when the grant
   * was issued (D-145 rule 1). `Enrolment` rows are kept for life on D-059's
   * rule, so resolving coverage from their EXISTENCE would give an internal
   * examiner permanent sight of every child who has ever taken the course —
   * F-114's failure, one table across. A closed enrolment grants nothing.
   */
  async isEnrolledInCourse(input: {
    courseId: string;
    studentProfileId: string;
    at: Date;
  }): Promise<boolean> {
    const found = await prisma.enrolment.findFirst({
      where: {
        courseId: input.courseId,
        studentProfileId: input.studentProfileId,
        startedAt: { lte: input.at },
        OR: [{ endedAt: null }, { endedAt: { gt: input.at } }],
      },
      select: { id: true },
    });
    return found !== null;
  },

  /**
   * The groups taught under a course — `Group -> CourseLevel -> Course`.
   *
   * IT IS THE HINGE OF D-170's CONTAINMENT CHECK, not just a coverage rule: a
   * `UNIT` granter may grant at `COURSE` **only when every group in that course
   * sits in their unit**, and `grantCoversScope` computes that from this list.
   * That is the exact case a scope-type ranking waves through — `COURSE` looks
   * "narrower" than `UNIT`, so a Location Manager at Zuidbad grants themselves
   * a course that also runs at Noordbad. An empty answer REFUSES there (an
   * empty set is vacuously a subset, and treating it as one would hand the
   * granter cover over every group the course acquires later), which is why a
   * course with no groups is a safe answer rather than a broken one.
   *
   * ── WHY IT ASKS `groups` INSTEAD OF QUERYING `Group` ────────────────────
   *
   * The level ids are ours; the group rows are not. `CLAUDE.md` §4: a module
   * never reads another module's tables directly, it calls a published
   * function. `groupIdsForCourseLevels` is that function — unguarded and
   * id-only, exactly like `activeGroupMemberIds`, which `sessions` uses for the
   * mirror-image question. The dependency runs `courses -> groups`, which is
   * the direction `06-delivery.md` §5's DAG puts them in.
   */
  async groupsOfCourse(courseId: string): Promise<readonly string[]> {
    const levels = await prisma.courseLevel.findMany({
      where: { courseId },
      select: { id: true },
    });
    if (levels.length === 0) return [];
    return groupIdsForCourseLevels(levels.map((level) => level.id));
  },

  /**
   * The exam sessions of a course — §2.2's *"**all** its exam sessions"*.
   *
   * **EMPTY, AND NOT A STUB.** `ExamSession` belongs to the `exams` module,
   * which is not built, so the honest answer is that this installation has none
   * — not that the question cannot be answered. The difference matters: an
   * unregistered relation logs *"the module that owns the table has not
   * registered one"*, which would now be a false statement about a module that
   * exists.
   *
   * A LESSON IS DELIBERATELY NOT ONE OF THESE. §2.2 enumerates `COURSE`
   * coverage and `ScheduledSession` is not in the list; `sessionFilterForReach`
   * denies its `COURSES` branch for the same reason, so the predicate and the
   * list filter agree — which is the property `06-delivery.md` §2.1 exists to
   * protect. The asymmetry it creates is real and is recorded in
   * `docs/build/phase-2.0-courses-report.md`: a `COURSE`-scoped principal
   * reaches the course's GROUPS (through `groupsOfCourse`) and none of those
   * groups' lessons.
   */
  async sessionsOfCourse(): Promise<readonly string[]> {
    return [];
  },

  /**
   * A course's end date, for D-170's `COURSE` window ceiling (end date + 7
   * days).
   *
   * **ALWAYS NULL, WHICH REFUSES EVERY `COURSE` GRANT — and that is the safe
   * direction, not a shrug.** D-170 bounds the window at *"the course's own end
   * date + 7 days"*; `01-domain-model.md` §3.2, which is the authority on what
   * a `Course` holds, gives it `name, description, active` and no dates at all.
   * Two design statements, one of which has to give, and this phase is not the
   * place to decide which: adding a date would invent a fact the club must then
   * maintain, and defaulting the ceiling would put the value back under the
   * control of the person typing it — the thing D-052 could never enforce and
   * D-170 exists to fix.
   *
   * So `assertGrantable` refuses every `COURSE` proposal with `UNRESOLVABLE`.
   * Nothing in v1 issues one yet — §2.4's Internal examiner is the role that
   * needs it and `exams` is unbuilt — so the cost today is zero and the
   * question is recorded rather than answered:
   * `docs/build/phase-2.0-courses-report.md`, open question 1.
   *
   * A `COURSE` grant written directly to `RoleAssignment` still RESOLVES
   * normally — `resolveReach` reads no relation for it — so the coverage rules
   * above are live and tested. It is only the ISSUING path that refuses.
   */
  async courseEndDate(): Promise<Date | null> {
    return null;
  },
};
