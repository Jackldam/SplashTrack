/**
 * Pools and lanes — the facilities D-175 puts in this module.
 *
 * *"A lane is where a lesson happens, not who may read a child's record."* So
 * these are ordinary configuration rows: no reach filtering, no personal data,
 * and no authorization scope will ever be minted from one. Modelling a pool as
 * an `OrganizationUnit` would have given D-121's deliberately flat `UNIT` scope
 * a hierarchy, and modelling a lane as a scope type would have added a sixth
 * variant to `Reach` (D-147) for a concept that grants nobody access to anybody.
 *
 * The club has one location with two pools: six 25 m lanes and three (Jack,
 * 2026-09-03).
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { optionalInt, requiredInt, requiredText } from "@/lib/validation";
import { recordAuditEvent } from "@/modules/audit";

import { ensureSessionsRegistrations } from "../infrastructure/registrations";
import { listPools, type PoolView } from "../infrastructure/session-repository";
import { POOL_LENGTH_MAX, SEQUENCE_MAX, TEXT_MAX } from "./input";
import type { ActorContext } from "./schedule-service";

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

export interface CreatePoolInput {
  name: unknown;
  lengthMetres?: unknown;
}

/**
 * Adds a pool.
 *
 * `{ organization: true }`, and it has to be: a facility belongs to the club
 * rather than to a group or a unit, so there is nothing narrower to name. That
 * is the same reasoning `createPerson` and `createGroup` give — coverage is
 * resource containment (D-170), and this resource is contained by the
 * organisation.
 */
export async function createPool(
  actor: ActorContext,
  input: CreatePoolInput,
): Promise<{ id: string }> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { organization: true },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.poolName),
    lengthMetres: optionalInt(
      "lengthMetres",
      input.lengthMetres,
      1,
      POOL_LENGTH_MAX,
    ),
  };

  return prisma.$transaction(async (tx) => {
    const pool = await tx.pool.create({ data, select: { id: true } });

    await recordAuditEvent(
      {
        eventType: "sessions.pool.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "pool",
        targetId: pool.id,
        requestId: actor.requestId ?? null,
        changedFields: { fields: "name,lengthMetres" },
      },
      tx,
    );

    return pool;
  });
}

export interface CreateLaneInput {
  name: unknown;
  sequence?: unknown;
}

/** Adds a lane to a pool. */
export async function createLane(
  actor: ActorContext,
  poolId: string,
  input: CreateLaneInput,
): Promise<{ id: string }> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { organization: true },
    { at },
  );

  const data = {
    poolId,
    name: requiredText("name", input.name, TEXT_MAX.laneName),
    sequence:
      input.sequence === undefined || input.sequence === null
        ? 0
        : requiredInt("sequence", input.sequence, 0, SEQUENCE_MAX),
  };

  return prisma.$transaction(async (tx) => {
    const lane = await tx.lane.create({ data, select: { id: true } });

    await recordAuditEvent(
      {
        eventType: "sessions.lane.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "pool",
        targetId: poolId,
        requestId: actor.requestId ?? null,
        changedFields: { laneId: lane.id, fields: "name,sequence" },
      },
      tx,
    );

    return lane;
  });
}

/**
 * The club's pools and their lanes.
 *
 * Guarded on `planning.read` at the organisation. A pool holds no personal data,
 * so there is no reach filtering to do — but a screen that renders without any
 * permission check has still disclosed that this installation exists and what it
 * has, which is the failure `src/app/people/access.tsx` describes.
 */
export async function listPoolsForPrincipal(
  actor: ActorContext,
): Promise<PoolView[]> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.read",
    { organization: true },
    { at },
  );

  return listPools();
}
