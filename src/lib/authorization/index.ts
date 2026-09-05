/**
 * The scope/reach authorization model — the surface every module imports.
 *
 * `CLAUDE.md` rule 3: every read of person data goes through
 * `requirePermission` + `resolveReach` (D-147). `Reach` is opaque and
 * constructible only by `resolveReach` — never hand-build one, never widen one
 * "temporarily".
 *
 * What is deliberately NOT exported:
 *   - Any `Reach` constructor. There is none to export; they are module-private
 *     to `./reach`, which is why `resolveReach` lives in the same file.
 *   - `hasPermission`. §1.1 rule 1 keeps UI gating and authorization on separate
 *     code paths, and a non-throwing lookalike shipped months before the first
 *     screen is how the two get confused. It arrives with that screen.
 */
export {
  PERMISSION_CATALOGUE,
  PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  HIGH_RISK_PREFIXES,
  SELF_PERMISSIONS,
  SELF_PERMISSION_GAP,
  asPermissionKey,
  holdsHighRiskPermission,
  type PermissionKey,
} from "./permissions";

export {
  SCOPE_TYPES,
  SELF_IMPLIED_SCOPE_TYPES,
  BOUNDED_WINDOW_SCOPE_TYPES,
  WINDOW_CEILING_DAYS_PAST_REFERENT,
  InvalidResourceRefError,
  describeResourceRef,
  normaliseResourceRef,
  type NormalisedResourceRef,
  type ResourceKind,
  type ResourceRef,
  type Scope,
  type ScopeType,
} from "./scope";

export {
  ForgedReachError,
  assertIsReach,
  describeReach,
  holdsAnyHighRiskPermission,
  isEmptyReach,
  isReach,
  reachVariant,
  resolveReach,
  type Principal,
  type Reach,
  type ReachVariant,
  type ReachWindow,
  type ResolveReachOptions,
} from "./reach";

export { coversResource } from "./covers-resource";

export {
  PermissionDeniedError,
  requirePermission,
  type RequirePermissionOptions,
} from "./require-permission";

export {
  GrantRefusedError,
  assertGrantable,
  type AssertGrantableOptions,
  type GrantProposal,
  type GrantRefusalReason,
  type GrantRequest,
} from "./grant";

export {
  SCOPE_RELATION_NAMES,
  ScopeRelationUnavailableError,
  configureScopeRelations,
  resetScopeRelations,
  scopeRelations,
  type ScopeRelations,
} from "./scope-relations";
