/**
 * The module's single registration entry point — everything `courses` supplies
 * to a shared registry it does not own.
 *
 * Two registries, the same two `people`, `groups` and `sessions` use:
 *   - `configureScopeRelations` — the live domain facts coverage is computed
 *     from (D-145). Four of the thirteen are ours, and registering them is what
 *     makes `COURSE` reach mean anything at all: until now every branch of
 *     `coversResource`'s `COURSES` case threw and was converted into a denial.
 *   - `registerRelationshipSources` — D-066's "what still holds this person".
 *     One of §5.1's six is ours, and it is the one §5.1 names by the wrong
 *     table: *"an active `StudentProfile` enrolment"* is an `Enrolment` row,
 *     and `people`'s `studentProfileSource` says in its own comment that this
 *     source *"adds a source beside this one"* when `courses` arrives.
 *
 * WHY REGISTRATION IS AN EXPLICIT CALL AND NOT AN IMPORT-TIME SIDE EFFECT: both
 * registries are module-level mutable state, so a side effect on import would
 * make correctness depend on module evaluation ORDER — and, under a bundler
 * that splits server code into chunks, on which chunk happens to pull this
 * module in first. That failure appears as a DENIAL in production and passes
 * every test, because a test file imports everything eagerly.
 *
 * So {@link ensureCoursesRegistrations} is called at the top of every service
 * operation in this module. It is idempotent and costs one boolean check after
 * the first call. Both registries MERGE rather than replace, so calling it can
 * never unregister another module's contributions.
 */
import { configureScopeRelations } from "@/lib/authorization";
import { registerRelationshipSources } from "@/lib/retention/last-relationship";

import { coursesScopeRelations } from "./courses-scope-relations";
import { enrolmentRelationshipSource } from "./enrolment-relationship-source";

let registered = false;

/** Registers everything this module supplies, once per process. */
export function ensureCoursesRegistrations(): void {
  if (registered) return;
  configureScopeRelations(coursesScopeRelations);
  registerRelationshipSources([enrolmentRelationshipSource]);
  registered = true;
}

/**
 * Forgets that registration happened. TEST SEAM ONLY — paired with
 * `resetScopeRelations()` / `resetRelationshipSources()`, which a test calls
 * when it wants the throwing defaults back and would otherwise be defeated by
 * the flag above.
 */
export function resetCoursesRegistrations(): void {
  registered = false;
}
