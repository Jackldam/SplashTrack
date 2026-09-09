/**
 * The `groups` module's application service for `Group` itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS EVERY OPERATION IN THIS MODULE DOES, IN THIS ORDER
 *
 * 1. **Register what this module supplies.** `ensureGroupsRegistrations()` —
 *    idempotent, one boolean. It matters more here than anywhere else so far:
 *    without it, `activeInstructorGroupIds` stays on the throwing default and
 *    EVERY `GROUP`-scoped grant in the installation resolves to no coverage.
 *    Safe, and wrong.
 *
 * 2. **`requirePermission`, resource-referenced.** Never a bare permission check
 *    (D-030). Lists resolve a `Reach` instead and hand it to the repository as a
 *    required argument (D-031) — the same authority, translated rather than
 *    re-derived.
 *
 * 3. **Audit the write.** Identifiers and field NAMES only, never a value — an
 *    audit trail that recorded a child's name beside every change would become
 *    the largest personal-data store in the system, and an append-only one that
 *    cannot be corrected.
 *
 * Every write below is inside a transaction that has NOT yet committed when the
 * event is recorded, so `recordAuditEvent` (the throwing variant) is correct
 * everywhere: a failed append aborts the write rather than losing its record.
 *
 * SERVER-ONLY.
 */
import {
  PermissionDeniedError,
  requirePermission,
  resolveReach,
  type Principal,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalInt, optionalText, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import {
  findGroupDetail,
  listGroups,
  ReachCoversNoGroupError,
  type GroupDetail,
  type GroupListItem,
} from "../infrastructure/group-repository";
import { ensureGroupsRegistrations } from "../infrastructure/registrations";
import { CAPACITY_MAX, TEXT_MAX } from "./input";

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  /** Request correlation id, when in a request (`@/lib/api/request-id`). */
  readonly requestId?: string | null;
  /** The instant the whole operation is evaluated at. */
  readonly at?: Date;
}

export function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

/**
 * The group list.
 *
 * A `PermissionDeniedError` when the principal's reach covers no group — NOT an
 * empty list. This is the case the definition of done names directly: an
 * instructor whose `InstructorAssignment` has ended resolves to `NONE` (D-145
 * rule 1 refuses to admit the group id into their reach at all), and the honest
 * answer is a refusal. An empty table would tell them the club has no groups.
 */
export async function listGroupsForPrincipal(
  actor: ActorContext,
  options: { includeInactive?: boolean } = {},
): Promise<GroupListItem[]> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  // No `requirePermission`: a list names no single resource, so there is
  // nothing for D-030's required reference to point at. The authority is the
  // same — this `Reach` is the only thing the repository accepts, and it carries
  // the live validity window and the live relation rules.
  const reach = await resolveReach(actor.principal, "groups.read", { at });

  try {
    return await listGroups(reach, at, options);
  } catch (error) {
    if (error instanceof ReachCoversNoGroupError) {
      throw new PermissionDeniedError("groups.read", "group list");
    }
    throw error;
  }
}

/**
 * One group with its current members and instructors.
 *
 * Guarded per resource. A `GROUP`-scoped instructor passes for their own group
 * — and only while their assignment is open, which is `resolveReach`'s live
 * check, not this function's.
 */
export async function getGroupForPrincipal(
  actor: ActorContext,
  groupId: string,
): Promise<GroupDetail | null> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.read",
    { group: groupId },
    { at },
  );

  return findGroupDetail(groupId, at);
}

export interface CreateGroupInput {
  name: unknown;
  capacity?: unknown;
  unitId?: unknown;
}

/**
 * Creates a group.
 *
 * The resource reference is `{ organization: true }`, for the reason
 * `createPerson` gives: a group that does not exist yet has no unit and no home,
 * so there is nothing narrower to name. The consequence is stated rather than
 * hidden — creating a group needs an `ORGANIZATION`-scoped `groups.manage`. That
 * is the honest reading of a model in which coverage is resource containment
 * (D-170) and the resource does not exist; the alternative is a create path that
 * names no resource at all, which D-030 forbids for exactly this reason.
 */
export async function createGroup(
  actor: ActorContext,
  input: CreateGroupInput,
): Promise<{ id: string }> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.manage",
    { organization: true },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.groupName),
    capacity: optionalInt("capacity", input.capacity, 1, CAPACITY_MAX),
    unitId: optionalText("unitId", input.unitId, 40),
  };

  return prisma.$transaction(async (tx) => {
    const group = await tx.group.create({ data, select: { id: true } });

    await recordAuditEvent(
      {
        eventType: "groups.group.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: group.id,
        requestId: actor.requestId ?? null,
        // FIELD NAMES and one non-personal token. A group name is not personal
        // data, but recording values here would still start a habit this trail
        // cannot afford — so `capacityStated` says whether a ceiling exists
        // without saying what it is.
        changedFields: {
          fields: "name,capacity,unitId",
          capacityStated: data.capacity !== null,
        },
      },
      tx,
    );

    return group;
  });
}

export interface UpdateGroupInput {
  name: unknown;
  capacity?: unknown;
  active?: unknown;
}

/** An ordinary edit, audited like every other write. */
export async function updateGroup(
  actor: ActorContext,
  groupId: string,
  input: UpdateGroupInput,
): Promise<void> {
  ensureGroupsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "groups.manage",
    { group: groupId },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.groupName),
    capacity: optionalInt("capacity", input.capacity, 1, CAPACITY_MAX),
    active: input.active === undefined ? undefined : input.active === "on",
  };

  await prisma.$transaction(async (tx) => {
    const before = await tx.group.findUnique({
      where: { id: groupId },
      select: { name: true, capacity: true, active: true },
    });
    if (!before) return;

    const changed = (["name", "capacity", "active"] as const).filter(
      (field) => data[field] !== undefined && before[field] !== data[field],
    );
    if (changed.length === 0) return;

    await tx.group.update({ where: { id: groupId }, data });

    await recordAuditEvent(
      {
        eventType: "groups.group.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "group",
        targetId: groupId,
        requestId: actor.requestId ?? null,
        changedFields: { fields: changed.join(",") },
      },
      tx,
    );
  });
}
