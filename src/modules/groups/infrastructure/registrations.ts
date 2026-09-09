/**
 * The module's single registration entry point — everything `groups` supplies to
 * a shared registry it does not own.
 *
 * Two registries, the same two `people` uses:
 *   - `configureScopeRelations` — the live domain facts coverage is computed
 *     from (D-145). Three of the thirteen are ours, and two of those three ARE
 *     D-145 rule 1.
 *   - `registerRelationshipSources` — D-066's "what still holds this person".
 *     One of §5.1's six is ours.
 *
 * WHY REGISTRATION IS AN EXPLICIT CALL AND NOT AN IMPORT-TIME SIDE EFFECT: both
 * registries are module-level mutable state, so a side effect on import would
 * make correctness depend on module evaluation ORDER — and, under a bundler that
 * splits server code into chunks, on which chunk happens to pull this module in
 * first. That failure appears as a DENIAL in production and passes every test,
 * because a test file imports everything eagerly.
 *
 * So {@link ensureGroupsRegistrations} is called at the top of every service
 * operation in this module. It is idempotent and costs one boolean check after
 * the first call. Both registries MERGE rather than replace, so calling it can
 * never unregister `people`'s or `sessions`' contributions.
 */
import { configureScopeRelations } from "@/lib/authorization";
import { registerRelationshipSources } from "@/lib/retention/last-relationship";

import { groupsScopeRelations } from "./groups-scope-relations";
import { instructorAssignmentSource } from "./instructor-relationship-source";

let registered = false;

/** Registers everything this module supplies, once per process. */
export function ensureGroupsRegistrations(): void {
  if (registered) return;
  configureScopeRelations(groupsScopeRelations);
  registerRelationshipSources([instructorAssignmentSource]);
  registered = true;
}

/**
 * Forgets that registration happened. TEST SEAM ONLY — paired with
 * `resetScopeRelations()` / `resetRelationshipSources()`, which a test calls
 * when it wants the throwing defaults back and would otherwise be defeated by
 * the flag above.
 */
export function resetGroupsRegistrations(): void {
  registered = false;
}
