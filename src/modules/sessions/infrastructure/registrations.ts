/**
 * The module's single registration entry point — everything `sessions` supplies
 * to a shared registry it does not own.
 *
 * ONE registry, unlike `people` and `groups`: `configureScopeRelations`. Three
 * of the thirteen relations are ours (`groupOfSession`, `isOnSessionRoster`,
 * `sessionDate`).
 *
 * There is deliberately NO relationship source here. D-066 asks what still HOLDS
 * a person, and nothing this module owns does: a `ScheduledSession` references a
 * group and a pool, and a `SessionRosterEntry` references a `StudentProfile` —
 * which `people` already reports through `studentProfileSource`. Registering a
 * source that duplicated it would double-count an ending in the aggregation,
 * which is exactly why that registry is keyed by name.
 *
 * WHY REGISTRATION IS AN EXPLICIT CALL AND NOT AN IMPORT-TIME SIDE EFFECT: the
 * registry is module-level mutable state, so a side effect on import would make
 * correctness depend on module evaluation ORDER — and, under a bundler that
 * splits server code into chunks, on which chunk pulls this module in first.
 * That failure appears as a DENIAL in production and passes every test, because
 * a test file imports everything eagerly.
 *
 * It also calls `ensureGroupsRegistrations`, because every operation in this
 * module reaches a group: a `UNIT`-scoped principal's coverage of a session
 * resolves through `groupOfSession` **and then** `unitOfGroup`, which `groups`
 * owns. Registering only half of that chain gives a denial nobody can explain.
 */
import { configureScopeRelations } from "@/lib/authorization";
import { ensureGroupsRegistrations } from "@/modules/groups";

import { sessionsScopeRelations } from "./sessions-scope-relations";

let registered = false;

/** Registers everything this module supplies, once per process. */
export function ensureSessionsRegistrations(): void {
  if (registered) return;
  configureScopeRelations(sessionsScopeRelations);
  // The other half of session coverage. Idempotent, and MERGE semantics mean
  // calling it can never unregister anything.
  ensureGroupsRegistrations();
  registered = true;
}

/** Forgets that registration happened. TEST SEAM ONLY. */
export function resetSessionsRegistrations(): void {
  registered = false;
}
