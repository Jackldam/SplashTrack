/**
 * `requirePermission` — the guard every write and every single-resource read
 * passes through.
 *
 * ```text
 * requirePermission(principal, 'attendance.record', { group: groupId })
 * ```
 *
 * One question: *does the caller hold any grant whose permission includes this
 * one AND whose scope covers the referenced resource?* (§2.2). The resource
 * reference is REQUIRED (D-030) — `hasPermission('students.read')` is
 * meaningless in a scoped world, and allowing an unscoped check would let an
 * instructor's group-scoped permission read the entire organisation.
 *
 * **Deny by default** (§1.1 rule 2). Missing arguments, absent grant, expired
 * grant, an unregistered scope relation, or *any unexpected failure including
 * the database being unreachable* result in denial. Nothing ambiguous becomes
 * an allow, and every denial is logged with its cause.
 *
 * **UI gating is a different function.** §1.1 rule 1 makes hiding a button and
 * authorizing an act two separate code paths — `hasPermission` for the UI,
 * `requirePermission` for the act. `hasPermission` is deliberately NOT in this
 * file: v1 has no screens yet, and shipping a non-throwing lookalike beside the
 * guard, months before anything renders, is how the two get confused. It
 * arrives with the first surface that needs it.
 *
 * **No second dimension.** D-143 is explicit that v1's poolside protection is
 * the permission set and the idle timeout, and that there is "no second
 * dimension in `requirePermission`, no context deny-list". There is no device
 * mode, no shared-session flag and no caller context here.
 */
import { logger } from "@/lib/logging";

import { coversResource } from "./covers-resource";
import type { PermissionKey } from "./permissions";
import {
  describeReach,
  resolveReach,
  type Principal,
  type Reach,
} from "./reach";
import {
  describeResourceRef,
  normaliseResourceRef,
  type ResourceRef,
} from "./scope";

/**
 * Thrown when a guarded operation is not permitted.
 *
 * Carries the permission and the resource so a route handler can produce a
 * standardized response and an audit event, and so a denial is diagnosable
 * without re-running the check. It deliberately does NOT carry the reach or the
 * grants examined: a denial message that explains which grants a caller *does*
 * hold is an enumeration primitive.
 */
export class PermissionDeniedError extends Error {
  constructor(
    public readonly permission: PermissionKey,
    public readonly resource: string,
  ) {
    super(`Permission denied: ${permission} on ${resource}.`);
    this.name = "PermissionDeniedError";
  }
}

export interface RequirePermissionOptions {
  /**
   * The instant to evaluate at. Defaults to now, and is passed to BOTH the
   * grant-window check and the coverage rules, so one request cannot resolve a
   * grant as live and then evaluate its coverage a second later.
   */
  readonly at?: Date;
}

/**
 * Authorizes one operation on one resource, or throws.
 *
 * Returns the `Reach` that satisfied the check, so a handler that guards a
 * write and then lists something does not resolve twice. That return is a
 * convenience and never a widening: it is the same opaque value `resolveReach`
 * produced.
 */
export async function requirePermission(
  principal: Principal,
  permission: PermissionKey,
  resource: ResourceRef,
  options: RequirePermissionOptions = {},
): Promise<Reach> {
  const at = options.at ?? new Date();

  // Normalised up front so a malformed reference is refused before any grant is
  // read, and so the denial log names the resource rather than "[object Object]".
  let described: string;
  try {
    described = describeResourceRef(normaliseResourceRef(resource));
  } catch (error) {
    logger.error(
      {
        component: "authorization",
        event: "guard.invalid_ref",
        permission,
        personId: principal.personId,
        err: error,
      },
      "guarded call named no single resource — denying",
    );
    throw new PermissionDeniedError(permission, "<invalid reference>");
  }

  // Expiry is evaluated HERE, inside the guard, never by a cleanup job (D-144).
  const reach = await resolveReach(principal, permission, { at });

  if (!(await coversResource(reach, resource, at))) {
    logger.info(
      {
        component: "authorization",
        event: "guard.denied",
        permission,
        resource: described,
        personId: principal.personId,
        reach: describeReach(reach),
      },
      "permission denied",
    );
    throw new PermissionDeniedError(permission, described);
  }

  return reach;
}
