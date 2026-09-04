/**
 * Guardians and emergency contacts — recording who answers for whom, and
 * deriving whether that authority still holds (D-063, D-151).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO PEOPLE, ONE ROW, AND WHICH ONE THE GUARD NAMES
 *
 * Every operation here is guarded on the SUBJECT — the child, `toPersonId`.
 * That is the person the record is about: whose consent is being answered for,
 * whose file the relationship appears in, and whose reach a `UNIT`-scoped
 * administrator has or has not got. Guarding on the guardian instead would let
 * a principal who may read the parent, but not the child, attach a guardianship
 * to that child.
 *
 * The relative's own copy of the relationship is a consequence of the same row,
 * and is visible to anyone who may read them — which is correct: "you are
 * recorded as guardian of a pupil here" is a fact about the guardian too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READING THE EVIDENCE IS ITS OWN OPERATION
 *
 * `PersonRelationship.evidence` is encrypted under the D-096/D-167 envelope and
 * is not part of any general projection. Disclosing it is a separate call, with
 * its own guard and its own AUDIT EVENT WRITTEN BEFORE THE DISCLOSURE — the
 * audit module's "no access without a record" posture, using the THROWING
 * variant, so a value is never revealed by a request whose record could not be
 * written.
 *
 * That read-auditing is not something the design demands for this column (D-148
 * demands it for the protected free-text class, which this is not). It is here
 * because the column holds free text about a family's legal arrangements whose
 * worked example is a custody dispute, and "who looked at that" is a question
 * somebody will eventually ask. Recorded as a decision in the phase 1.1 report.
 *
 * SERVER-ONLY.
 */
import { requirePermission } from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { getConfiguredPrivacyPolicy } from "@/lib/settings";
import { recordAuditEvent } from "@/modules/audit";

import {
  resolveGuardianAuthority,
  type GuardianAuthority,
} from "../domain/guardian-authority";
import { ensurePeopleRegistrations } from "../infrastructure/registrations";
import {
  findRelationship,
  readRelationshipEvidence,
  sealEvidence,
} from "../infrastructure/person-repository";
import { optionalDate, optionalText, requiredEnum, TEXT_MAX } from "./input";
import type { ActorContext } from "./people-service";

export const RELATIONSHIP_TYPES = ["GUARDIAN_OF", "EMERGENCY_CONTACT"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface RecordRelationshipInput {
  /** The RELATIVE — guardian or emergency contact. */
  relativePersonId: string;
  /** The SUBJECT — the child, or the person the contact is for. */
  subjectPersonId: string;
  type: unknown;
  /** Does this relationship CLAIM authority to consent? */
  authority?: unknown;
  /** HOW the claim was established. Mandatory when `authority` is true. */
  evidence?: unknown;
  validFrom?: unknown;
}

/**
 * Records one relationship.
 *
 * THE ROW IS CREATED, THEN ITS EVIDENCE IS SEALED AGAINST ITS OWN ID, INSIDE
 * ONE TRANSACTION. That two-step is not clumsiness: the primary key is
 * AUTHENTICATED DATA in the envelope's AAD (D-096) — it is what stops one
 * family's evidence being copied into another's row — so the id has to exist
 * before the value can be sealed. Generating an id here instead would put a
 * second id-minting convention beside the schema's `cuid(2)` default for no
 * gain. Both statements commit together, so a row with an authority claim never
 * exists without its evidence.
 *
 * The database still holds the line independently:
 * `PersonRelationship_evidence_required_check` refuses an authority claim with
 * no evidence, whichever code path attempts it.
 */
export async function recordRelationship(
  actor: ActorContext,
  input: RecordRelationshipInput,
): Promise<{ relationshipId: string }> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  await requirePermission(
    actor.principal,
    "people.update",
    { person: input.subjectPersonId },
    { at },
  );

  const type = requiredEnum("type", input.type, RELATIONSHIP_TYPES);
  const authority = input.authority === true || input.authority === "true";
  const evidence = optionalText("evidence", input.evidence, TEXT_MAX.evidence);
  const validFrom = optionalDate("validFrom", input.validFrom) ?? at;

  if (authority && type !== "GUARDIAN_OF") {
    throw new Error(
      "Only a guardian relationship may carry consent authority. An emergency " +
        "contact is someone to telephone, not someone who may consent on a " +
        "child's behalf (PersonRelationship_authority_kind_check).",
    );
  }
  if (authority && evidence === null) {
    throw new Error(
      "An authority claim must record HOW it was established (D-063). The " +
        "application cannot verify guardianship — it can only record what it " +
        "was told, by whom, and on what basis — and a claim with no recorded " +
        "basis is the false comfort that decides a custody dispute wrongly.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.personRelationship.create({
      data: {
        fromPersonId: input.relativePersonId,
        toPersonId: input.subjectPersonId,
        type,
        authority,
        validFrom,
      },
      select: { id: true },
    });

    if (evidence !== null) {
      await tx.personRelationship.update({
        where: { id: created.id },
        // `sealEvidence` returns a `Sealed<...>` — a branded string with exactly
        // one producer. Handing this column a plaintext is a COMPILE error, not
        // a review miss, which is what "encrypting a field is the easy path and
        // forgetting to is not" means in practice.
        data: { evidence: sealEvidence(created.id, evidence) },
      });
    }

    await recordAuditEvent(
      {
        eventType: "people.relationship.recorded",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person_relationship",
        targetId: created.id,
        requestId: actor.requestId ?? null,
        changedFields: {
          subjectPersonId: input.subjectPersonId,
          relativePersonId: input.relativePersonId,
          type,
          authority,
          // WHETHER evidence was recorded, never a syllable of it.
          evidenceRecorded: evidence !== null,
        },
      },
      tx,
    );

    return { relationshipId: created.id };
  });
}

/**
 * Closes a relationship administratively — the school was told it has ended.
 *
 * DISTINCT FROM AUTHORITY LAPSING BY AGE, which touches no row at all (D-151).
 * A parent who is no longer the guardian is this; a child who turned sixteen is
 * the derivation. Conflating them would mean writing a `validTo` on a birthday,
 * which is the mechanism D-151 exists to replace.
 */
export async function endRelationship(
  actor: ActorContext,
  relationshipId: string,
  input: { validTo?: unknown } = {},
): Promise<void> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  const relationship = await findRelationship(relationshipId);
  if (!relationship) return;

  await requirePermission(
    actor.principal,
    "people.update",
    { person: relationship.toPersonId },
    { at },
  );

  const validTo = optionalDate("validTo", input.validTo) ?? at;

  await prisma.$transaction(async (tx) => {
    await tx.personRelationship.update({
      where: { id: relationshipId },
      data: { validTo },
    });

    await recordAuditEvent(
      {
        eventType: "people.relationship.ended",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person_relationship",
        targetId: relationshipId,
        requestId: actor.requestId ?? null,
        changedFields: {
          subjectPersonId: relationship.toPersonId,
          relativePersonId: relationship.fromPersonId,
          type: relationship.type,
          fields: "validTo",
        },
      },
      tx,
    );
  });
}

/**
 * D-151's derivation for one relationship, at one instant.
 *
 * READS THE SETTING, COMPUTES, WRITES NOTHING. No job marks a relationship when
 * a child turns sixteen, and none may: a job that has not run yet leaves
 * authority apparently valid, which is F-119 exactly. The pure rule lives in
 * `../domain/guardian-authority`; this only supplies the configured age.
 */
export async function describeRelationshipAuthority(
  relationship: {
    authority: boolean;
    validFrom: Date;
    validTo: Date | null;
    subjectDateOfBirth: Date | null;
  },
  at: Date = new Date(),
): Promise<GuardianAuthority> {
  const { ageOfDigitalConsentYears } = await getConfiguredPrivacyPolicy();
  return resolveGuardianAuthority(
    {
      authority: relationship.authority,
      validFrom: relationship.validFrom,
      validTo: relationship.validTo,
      subjectDateOfBirth: relationship.subjectDateOfBirth,
    },
    ageOfDigitalConsentYears,
    at,
  );
}

/**
 * Discloses one relationship's authority evidence.
 *
 * THE AUDIT EVENT IS WRITTEN BEFORE THE PLAINTEXT IS PRODUCED, with the
 * throwing variant. If the record cannot be written, the disclosure does not
 * happen — the audit module's own posture for a "no access without a record"
 * action, and this is one.
 *
 * The two are NOT in one transaction, deliberately: `readRelationshipEvidence`
 * only reads, so there is nothing to roll back, and an audit event for a
 * disclosure that then failed to render is the harmless direction. The
 * dangerous direction — a disclosure with no record — is the one the ordering
 * closes.
 */
export async function revealRelationshipEvidence(
  actor: ActorContext,
  relationshipId: string,
): Promise<{ subjectPersonId: string; evidence: string | null } | null> {
  ensurePeopleRegistrations();
  const at = actor.at ?? new Date();

  const relationship = await findRelationship(relationshipId);
  if (!relationship) return null;

  await requirePermission(
    actor.principal,
    "people.read",
    { person: relationship.toPersonId },
    { at },
  );

  await recordAuditEvent({
    eventType: "people.relationship.evidence_revealed",
    outcome: "SUCCESS",
    actorPersonId: actor.principal.personId,
    actorAuthMethod: "session",
    targetType: "person_relationship",
    targetId: relationshipId,
    requestId: actor.requestId ?? null,
    changedFields: {
      subjectPersonId: relationship.toPersonId,
      relativePersonId: relationship.fromPersonId,
      type: relationship.type,
    },
    reason: "Authority evidence disclosed to a signed-in administrator.",
  });

  return {
    subjectPersonId: relationship.toPersonId,
    evidence: await readRelationshipEvidence(relationshipId),
  };
}
