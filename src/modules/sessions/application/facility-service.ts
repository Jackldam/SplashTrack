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
 * ─────────────────────────────────────────────────────────────────────────────
 * A POOL'S NAME AND LENGTH ARE ORDINARY EDITABLE ATTRIBUTES, AND THE UPDATES
 * BELOW ARE NOT A BREACH OF `CLAUDE.md` RULE 4
 *
 * Rule 4 is about HISTORY: attendance and exam results are event logs, and a
 * correction there writes a superseding event because the earlier answer is
 * itself evidence — somebody was marked absent, somebody was told they passed.
 *
 * A pool's name is not evidence of anything. *"Instructiebad"* typed as
 * *"Instructiebda"* has no earlier state worth reconstructing, and there is no
 * question a person can ask that the previous spelling answers. Superseding
 * rows here would give the club two pools where it has one, and every screen
 * that lists facilities would have to learn to hide the corrected ones.
 *
 * What keeps the correction accountable is the AUDIT EVENT: who changed which
 * fields, when. That is the right instrument for a configuration row, and it is
 * the same one `updateGroup` and `updatePerson` already use.
 *
 * The distinction is drawn per attribute and not per table. If a facility ever
 * grows something that IS evidence, that column does not become editable
 * because the ones beside it are.
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

/**
 * A refusal a person caused and can act on, as opposed to a bug.
 *
 * `duplicateName` exists because the schema is right to hold `Pool.name` and
 * `Lane[poolId, name]` unique and a Prisma uniqueness violation reaches a
 * screen as a 500. The person renaming *"Instructiebda"* to *"Instructiebad"*
 * when a pool by that name already exists has made an ordinary mistake and
 * needs a sentence, not an error page.
 */
export class FacilityError extends Error {
  constructor(
    // `facilityNotFound` and not `notFound`: a reason travels to the screen as
    // a message key, `ScheduleError` already owns `notFound` for a lesson, and
    // two refusals sharing a key means one of them renders the other's Dutch.
    public readonly reason: "duplicateName" | "facilityNotFound",
    message: string,
  ) {
    super(message);
    this.name = "FacilityError";
  }
}

function prismaCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Prisma's unique-constraint code, translated where it can occur. */
function isUniqueViolation(error: unknown): boolean {
  return prismaCode(error) === "P2002";
}

/** Prisma's foreign-key code: a lane added to a pool that is not there. */
function isMissingReference(error: unknown): boolean {
  return prismaCode(error) === "P2003";
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

  try {
    return await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new FacilityError("duplicateName", "A pool by that name exists.");
    }
    throw error;
  }
}

export interface UpdatePoolInput {
  name: unknown;
  lengthMetres?: unknown;
  /** `"on"` from a checkbox, or absent. Undefined leaves the flag alone. */
  active?: unknown;
}

/**
 * Corrects a pool.
 *
 * THE OPERATION THAT WAS MISSING, and its absence was not a small gap: a pool
 * created with a typo could be fixed only by editing the database, which is not
 * a repair path for the person this was built for. See the file header for why
 * an in-place update is the right shape for these three attributes.
 *
 * `planning.manage`, checked HERE and not merely on the page that renders the
 * form. An edit form is a write surface and a Server Action is reachable by POST
 * without it, so a caller holding only `planning.read` — enough to reach the
 * screen — is refused at the service, which is the only place that counts.
 *
 * Nothing is written when nothing changed. A save that rewrites identical values
 * would append an audit event saying a field changed when it did not, and an
 * audit trail with entries for non-events is one nobody reads.
 */
export async function updatePool(
  actor: ActorContext,
  poolId: string,
  input: UpdatePoolInput,
): Promise<void> {
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
    active: input.active === undefined ? undefined : input.active === "on",
  };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.pool.findUnique({
        where: { id: poolId },
        select: { name: true, lengthMetres: true, active: true },
      });
      if (!before) {
        throw new FacilityError(
          "facilityNotFound",
          "That pool does not exist.",
        );
      }

      const changed = (["name", "lengthMetres", "active"] as const).filter(
        (field) => data[field] !== undefined && before[field] !== data[field],
      );
      if (changed.length === 0) return;

      await tx.pool.update({ where: { id: poolId }, data });

      await recordAuditEvent(
        {
          eventType: "sessions.pool.updated",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          targetType: "pool",
          targetId: poolId,
          requestId: actor.requestId ?? null,
          // Field NAMES, never values — the same rule every other write in the
          // application follows, kept here even though a pool's name is not
          // personal data, because the rule is what makes the trail readable.
          changedFields: { fields: changed.join(",") },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new FacilityError("duplicateName", "A pool by that name exists.");
    }
    throw error;
  }
}

export interface CreateLaneInput {
  name: unknown;
  sequence?: unknown;
}

/**
 * Adds a lane to a pool.
 *
 * IT EXISTED BEFORE THIS PHASE AND NO SCREEN CALLED IT. The capability was in
 * the module, exported from `index.ts`, and the pools page imported
 * `createPoolAction` alone — so the club could record that it has a pool and
 * could not record any of the lanes in it. A service nothing reaches is not a
 * feature; `docs/build/phase-1.7-…` records the class of defect.
 */
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

  try {
    return await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new FacilityError(
        "duplicateName",
        "That pool already has a lane by that name.",
      );
    }
    if (isMissingReference(error)) {
      throw new FacilityError("facilityNotFound", "That pool does not exist.");
    }
    throw error;
  }
}

export interface UpdateLaneInput {
  name: unknown;
  sequence?: unknown;
}

/**
 * Corrects a lane.
 *
 * The lane is addressed by its OWN id and the pool it belongs to is read from
 * the row, never taken from the caller. A `poolId` on the form would be a field
 * an attacker could change to move somebody else's lane, and the only thing it
 * would have bought is one query.
 *
 * A lane cannot be moved to another pool. Not a limitation to be lifted later:
 * `SessionLane` points lessons at a lane, so a lane that changes pool rewrites
 * where every lesson ever taught in it happened. A lane in the wrong pool is
 * added to the right one; the wrong one is renamed or left.
 */
export async function updateLane(
  actor: ActorContext,
  laneId: string,
  input: UpdateLaneInput,
): Promise<void> {
  ensureSessionsRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "planning.manage",
    { organization: true },
    { at },
  );

  const data = {
    name: requiredText("name", input.name, TEXT_MAX.laneName),
    sequence:
      input.sequence === undefined || input.sequence === null
        ? undefined
        : requiredInt("sequence", input.sequence, 0, SEQUENCE_MAX),
  };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.lane.findUnique({
        where: { id: laneId },
        select: { poolId: true, name: true, sequence: true },
      });
      if (!before) {
        throw new FacilityError(
          "facilityNotFound",
          "That lane does not exist.",
        );
      }

      const changed = (["name", "sequence"] as const).filter(
        (field) => data[field] !== undefined && before[field] !== data[field],
      );
      if (changed.length === 0) return;

      await tx.lane.update({ where: { id: laneId }, data });

      await recordAuditEvent(
        {
          eventType: "sessions.lane.updated",
          outcome: "SUCCESS",
          actorPersonId: actor.principal.personId,
          actorAuthMethod: "session",
          // The POOL is the target, as it is for `sessions.lane.created`: a
          // lane is read as part of the pool that has it, and an auditor
          // looking for "what happened to the instruction pool" should not
          // have to know a lane id to find it.
          targetType: "pool",
          targetId: before.poolId,
          requestId: actor.requestId ?? null,
          changedFields: { laneId, fields: changed.join(",") },
        },
        tx,
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new FacilityError(
        "duplicateName",
        "That pool already has a lane by that name.",
      );
    }
    throw error;
  }
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
