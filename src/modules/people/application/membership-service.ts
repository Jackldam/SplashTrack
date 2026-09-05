/**
 * Membership administration — D-059's intervals, as operations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH PERMISSION GATES THIS, AND WHY IT IS NOT `membership.manage`
 *
 * §2.5's catalogue defines `people.*` and `students.*` and NO membership
 * permission, while §2.4's *Member Administrator* is the role that administers
 * membership. §2.5's own rule settles which of those wins: *"a permission
 * referenced anywhere in the design set and absent here is a defect, not a
 * shorthand"* — so inventing `membership.manage` at this call site would put
 * the catalogue's second home in this file, which is exactly what
 * `PermissionKey` being a union rather than `string` exists to prevent.
 *
 * Membership operations are therefore gated on `people.update` over the person,
 * and that is recorded as a decision rather than an assumption. If the club
 * later wants member administration separable from rectification, the fix is a
 * catalogue key in §2.5 and one edit here — not a string invented locally.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * D-060: MEMBERSHIP GRANTS NOTHING
 *
 * Nothing in this file touches `RoleAssignment`, and nothing may. Membership is
 * an administrative and often financial relationship; authorization is a
 * security concern. A volunteer instructor who is not a paying member gets a
 * role with no membership at all, and a member gets no permission by being one.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

import {
  assertCanEndPeriod,
  assertCanStartPeriod,
  type MembershipInterval,
} from "../domain/membership";
import {
  MEMBER_NUMBER_PREFIX,
  nextAllocatedNumber,
  normaliseSuppliedNumber,
} from "../domain/numbering";
import { ensurePeopleRegistrations } from "../infrastructure/registrations";
import { optionalDate, optionalText, requiredDate, TEXT_MAX } from "./input";
import type { ActorContext } from "./people-service";

/**
 * Creates the person's `Membership` — the one row they keep for life — and
 * opens its first period.
 *
 * ONE PER PERSON, FOREVER (§3.1). `Membership.personId` is unique, so a second
 * call for the same person is a database error rather than a second register
 * entry, and that is the constraint that makes "the number stays the same
 * across gaps" true rather than merely intended.
 */
export async function createMembership(
  actor: ActorContext,
  personId: string,
  input: {
    memberNumber?: unknown;
    unitId?: unknown;
    startedAt?: unknown;
  } = {},
): Promise<{ membershipId: string; memberNumber: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "people.update",
    { person: personId },
    { at },
  );

  const supplied = optionalText("memberNumber", input.memberNumber, 32);
  const unitId = optionalText("unitId", input.unitId, 64);
  const startedAt = optionalDate("startedAt", input.startedAt) ?? at;

  return prisma.$transaction(async (tx) => {
    // Allocation reads inside the transaction that writes, so two concurrent
    // registrations cannot compute the same next number and both believe it.
    // The unique index is still the control — this is what stops the common
    // case from reaching it.
    const memberNumber = supplied
      ? normaliseSuppliedNumber("memberNumber", supplied)
      : nextAllocatedNumber(
          MEMBER_NUMBER_PREFIX,
          (
            await tx.membership.findMany({ select: { memberNumber: true } })
          ).map((row) => row.memberNumber),
        );

    const membership = await tx.membership.create({
      data: {
        personId,
        memberNumber,
        unitId,
        periods: { create: { startedAt } },
      },
      select: { id: true, memberNumber: true },
    });

    await recordAuditEvent(
      {
        eventType: "people.membership.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "membership",
        targetId: membership.id,
        requestId: actor.requestId ?? null,
        // Field names and non-personal tokens. A member number is the club's
        // own administrative key rather than a personal-data VALUE, but it is
        // still an identifier of a person, so the trail carries only whether it
        // was supplied or allocated — the id above is what a reader follows.
        changedFields: {
          personId,
          numberSource: supplied ? "supplied" : "allocated",
          unitAssigned: unitId !== null,
        },
      },
      tx,
    );

    return {
      membershipId: membership.id,
      memberNumber: membership.memberNumber,
    };
  });
}

/**
 * Opens a NEW membership period — a first one, or the one that records a return
 * after a gap.
 *
 * THIS IS WHAT "LEAVE AND RETURN" IS. It never reopens a closed period, never
 * edits one, and never creates a second `Membership`: the member number stays
 * the same and the gap between the two periods becomes a fact the record
 * carries. A status flag would have destroyed exactly that (D-059).
 */
export async function startMembershipPeriod(
  actor: ActorContext,
  personId: string,
  input: { startedAt?: unknown } = {},
): Promise<{ periodId: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "people.update",
    { person: personId },
    { at },
  );

  const startedAt = optionalDate("startedAt", input.startedAt) ?? at;

  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { personId },
      select: {
        id: true,
        periods: { select: { startedAt: true, endedAt: true } },
      },
    });
    if (!membership) {
      throw new Error(
        "This person has no Membership. Create the membership first — the " +
          "member number is one per person for life (D-059), so a period " +
          "cannot exist without the register entry it belongs to.",
      );
    }

    // The domain rule, checked before the write so the caller gets a sentence
    // rather than a unique-index violation. The partial index is still the
    // control against a race.
    assertCanStartPeriod(membership.periods satisfies MembershipInterval[]);

    const period = await tx.membershipPeriod.create({
      data: { membershipId: membership.id, startedAt },
      select: { id: true },
    });

    await recordAuditEvent(
      {
        eventType: "people.membership_period.started",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "membership_period",
        targetId: period.id,
        requestId: actor.requestId ?? null,
        changedFields: {
          personId,
          membershipId: membership.id,
          // How many intervals of belonging this person now has — the number
          // that makes a return visible in the trail without a second query.
          periodOrdinal: membership.periods.length + 1,
        },
      },
      tx,
    );

    return { periodId: period.id };
  });
}

/**
 * Closes the open period. The row is UPDATED once, from open to closed, and
 * never again — a closed period is history.
 *
 * This is the only update in the module that changes a fact rather than
 * correcting an identity field, and it is not a status flag in disguise: it
 * writes the END of an interval, which is information the row did not carry
 * before. Reopening it is refused (`assertCanStartPeriod`); returning starts a
 * new one.
 */
export async function endMembershipPeriod(
  actor: ActorContext,
  personId: string,
  input: { endedAt: unknown; endReason?: unknown },
): Promise<{ periodId: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "people.update",
    { person: personId },
    { at },
  );

  const endedAt = requiredDate("endedAt", input.endedAt);
  const endReason = optionalText("endReason", input.endReason, TEXT_MAX.reason);

  return prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findUnique({
      where: { personId },
      select: {
        id: true,
        periods: {
          select: { id: true, startedAt: true, endedAt: true },
          orderBy: [{ startedAt: "asc" }],
        },
      },
    });
    if (!membership) {
      throw new Error("This person has no Membership.");
    }

    assertCanEndPeriod(membership.periods, endedAt);
    const open = membership.periods.find((period) => period.endedAt === null)!;

    await tx.membershipPeriod.update({
      where: { id: open.id },
      data: { endedAt, endReason },
    });

    await recordAuditEvent(
      {
        eventType: "people.membership_period.ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "membership_period",
        targetId: open.id,
        requestId: actor.requestId ?? null,
        changedFields: {
          personId,
          membershipId: membership.id,
          fields: endReason ? "endedAt,endReason" : "endedAt",
          // Whether a reason was given, never the reason itself — it is free
          // text about a family and belongs on the row, not on the trail.
          reasonGiven: endReason !== null,
        },
      },
      tx,
    );

    return { periodId: open.id };
  });
}
