/**
 * The module's single registration entry point — everything `people` supplies to
 * a shared registry it does not own.
 *
 * Two registries today:
 *   - `configureScopeRelations` (`@/lib/authorization`) — the live domain facts
 *     coverage is computed from (D-145). Three of the thirteen are ours.
 *   - `registerRelationshipSources` (`@/lib/retention/last-relationship`) —
 *     D-066's "what still holds this person". Three of §5.1's six are ours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY REGISTRATION IS AN EXPLICIT CALL AND NOT AN IMPORT-TIME SIDE EFFECT
 *
 * Both registries are module-level mutable state. A side effect on import would
 * make correctness depend on module evaluation ORDER — and, under a bundler that
 * splits server code into chunks, on which chunk happens to pull this module in
 * first. That failure appears as a DENIAL in production and passes every test,
 * because a test file imports everything eagerly.
 *
 * So {@link ensurePeopleRegistrations} is called at the top of every service
 * operation in this module. It is idempotent and costs one boolean check after
 * the first call. Both registries MERGE rather than replace, so calling it can
 * never unregister another module's contributions.
 */
import { configureScopeRelations } from "@/lib/authorization";
import { registerRelationshipSources } from "@/lib/retention/last-relationship";

import { peopleScopeRelations } from "./people-scope-relations";
import {
  guardianRelationshipSource,
  membershipPeriodSource,
  studentProfileSource,
} from "./relationship-sources";

let registered = false;

/**
 * Registers everything this module supplies, once per process. Idempotent,
 * cheap, and safe to call from anywhere — including a test's `beforeEach`,
 * which is why it is exported rather than private.
 */
export function ensurePeopleRegistrations(): void {
  if (registered) return;
  configureScopeRelations(peopleScopeRelations);
  registerRelationshipSources([
    membershipPeriodSource,
    studentProfileSource,
    guardianRelationshipSource,
  ]);
  registered = true;
}

/**
 * Forgets that registration happened. TEST SEAM ONLY — paired with
 * `resetScopeRelations()` / `resetRelationshipSources()`, which a test calls
 * when it wants the empty defaults back and would otherwise be defeated by the
 * flag above.
 */
export function resetPeopleRegistrations(): void {
  registered = false;
}
