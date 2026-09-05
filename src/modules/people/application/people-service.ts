/**
 * The `people` module's application service for `Person` itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS EVERY OPERATION IN THIS MODULE DOES, IN THIS ORDER
 *
 * 1. **Register what this module supplies.** `ensurePeopleRegistrations()`
 *    — idempotent, one boolean. Without it a `UNIT`-scoped principal's coverage
 *    of a person cannot be resolved and DENIES, which is safe but wrong.
 *
 * 2. **`requirePermission`, resource-referenced.** Never a bare permission
 *    check: `hasPermission('people.read')` is meaningless in a scoped world
 *    (D-030), and there is no branch in this file that reaches a row without
 *    passing one. Lists resolve a `Reach` instead and hand it to the repository
 *    as a required argument (D-031) — the same authority, translated rather
 *    than re-derived.
 *
 * 3. **Audit the write.** Every write that touches personal data is an audited
 *    event (`CLAUDE.md` rule 2). Identifiers and field NAMES only — never a
 *    value, because an audit trail that recorded a child's name beside every
 *    change would become the largest personal-data store in the system, and an
 *    append-only one that cannot be corrected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHICH VARIANT OF THE AUDIT CALL, AND WHY IT IS NOT ALWAYS THE SAME ONE
 *
 * `recordAuditEvent` throws; `recordAuditEventSafe` does not. The rule the audit
 * module states is that a "no access without a record" action awaits the
 * throwing one BEFORE disclosing anything, while an already-committed change
 * uses the safe one so a failed append does not misrepresent an applied change.
 *
 * In this module every write is inside a transaction that has NOT yet committed
 * when the event is recorded — so the throwing variant is correct everywhere,
 * and a failed append aborts the write rather than losing its record. The one
 * place the safe variant would apply is a post-commit event, and there is none.
 *
 * SERVER-ONLY.
 */
import {
  requirePermission,
  resolveReach,
  type Principal,
} from "@/lib/authorization";
import { prisma } from "@/lib/database";
import { recordAuditEvent } from "@/modules/audit";

import { ensurePeopleRegistrations } from "../infrastructure/registrations";
import {
  findPersonDetail,
  listPeople,
  relationshipsWithEvidence,
  ReachCoversNoPersonError,
  type PersonDetail,
  type PersonListItem,
} from "../infrastructure/person-repository";
import { optionalDate, optionalText, requiredText, TEXT_MAX } from "./input";
import { PermissionDeniedError } from "@/lib/authorization";

/** What identifies the acting principal and the request they act in. */
export interface ActorContext {
  readonly principal: Principal;
  /** Request correlation id, when in a request (`@/lib/api/request-id`). */
  readonly requestId?: string | null;
  /** The instant the whole operation is evaluated at. */
  readonly at?: Date;
}

function instant(actor: ActorContext): Date {
  return actor.at ?? new Date();
}

/**
 * The people list.
 *
 * A `PermissionDeniedError` when the principal's reach covers no `Person` —
 * NOT an empty list. `06-delivery.md` §2.1 makes the list case the one that must
 * never be dropped, and an empty result for a `GROUP`-scoped instructor is
 * indistinguishable from a club with no members: it teaches them the screen is
 * broken rather than that the record is not theirs to read.
 */
export async function listPeopleForPrincipal(
  actor: ActorContext,
  options: { query?: string } = {},
): Promise<PersonListItem[]> {
  ensurePeopleRegistrations();
  const at = instant(actor);

  // No `requirePermission` here, and that is not a gap: a list names no single
  // resource, so there is nothing for D-030's required reference to point at.
  // The authority is the same — the `Reach` this produces is the only thing the
  // repository will accept, and it carries the live validity window and the
  // live relation rules `requirePermission` would have applied.
  const reach = await resolveReach(actor.principal, "people.read", { at });

  const query = optionalText("query", options.query, TEXT_MAX.query);
  try {
    return await listPeople(reach, at, { query: query ?? undefined });
  } catch (error) {
    if (error instanceof ReachCoversNoPersonError) {
      throw new PermissionDeniedError("people.read", "person list");
    }
    throw error;
  }
}

/**
 * One person, with everything this module holds about them.
 *
 * Guarded per resource: `{ person: personId }`, which a `GROUP`-scoped
 * instructor fails and an `ORGANIZATION`- or covering `UNIT`-scoped principal
 * passes. `null` only when the row genuinely does not exist — a person the
 * caller may not read produces a DENIAL, not a not-found, because the two are
 * different answers and conflating them here would hide the denial from the
 * person who needs to understand it. (Enumeration is not a live concern for a
 * cuid2 id behind an authenticated, permission-checked surface.)
 */
export async function getPersonForPrincipal(
  actor: ActorContext,
  personId: string,
): Promise<(PersonDetail & { evidenceAvailable: ReadonlySet<string> }) | null> {
  ensurePeopleRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "people.read",
    { person: personId },
    { at },
  );

  const detail = await findPersonDetail(personId);
  if (!detail) return null;

  // Which relationships HOLD evidence — a boolean per row, computed without
  // selecting the ciphertext. The evidence itself is a separate, separately
  // guarded and separately audited read.
  const evidenceAvailable = await relationshipsWithEvidence([
    ...detail.guardians.map((relationship) => relationship.id),
    ...detail.dependants.map((relationship) => relationship.id),
  ]);

  return { ...detail, evidenceAvailable };
}

export interface CreatePersonInput {
  givenName: unknown;
  familyName: unknown;
  dateOfBirth?: unknown;
  email?: unknown;
  phone?: unknown;
}

/**
 * Creates a `Person`.
 *
 * The resource reference is `{ organization: true }`, and it has to be: a person
 * who does not exist yet has no unit, no group and no home, so there is nothing
 * narrower to name. The consequence is stated rather than hidden — creating a
 * person requires an `ORGANIZATION`-scoped `people.create`, so a `UNIT`-scoped
 * Member Administrator cannot register one. That is the honest reading of a
 * scope model in which coverage is resource containment (D-170) and the resource
 * does not exist yet; the alternative would be a create path that names no
 * resource at all, which D-030 forbids for exactly this reason.
 */
export async function createPerson(
  actor: ActorContext,
  input: CreatePersonInput,
): Promise<{ id: string }> {
  ensurePeopleRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "people.create",
    { organization: true },
    { at },
  );

  const data = {
    givenName: requiredText("givenName", input.givenName, TEXT_MAX.name),
    familyName: requiredText("familyName", input.familyName, TEXT_MAX.name),
    dateOfBirth: optionalDate("dateOfBirth", input.dateOfBirth),
    email: optionalText("email", input.email, TEXT_MAX.email),
    phone: optionalText("phone", input.phone, TEXT_MAX.phone),
  };

  return prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data, select: { id: true } });

    await recordAuditEvent(
      {
        eventType: "people.person.created",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person",
        targetId: person.id,
        requestId: actor.requestId ?? null,
        // FIELD NAMES and one non-personal token. `dateOfBirthKnown` is what
        // D-172's re-consent queue is populated by, so whether it was supplied is
        // a fact the trail should carry — the DATE itself never is.
        changedFields: {
          fields: "givenName,familyName,dateOfBirth,email,phone",
          dateOfBirthKnown: data.dateOfBirth !== null,
        },
      },
      // The caller's transaction: the event and the row it evidences commit
      // together or neither does.
      tx,
    );

    return person;
  });
}

export interface UpdatePersonInput {
  givenName: unknown;
  familyName: unknown;
  dateOfBirth?: unknown;
  email?: unknown;
  phone?: unknown;
}

/** Rectification (§5.5) — an ordinary edit, audited like every other write. */
export async function updatePerson(
  actor: ActorContext,
  personId: string,
  input: UpdatePersonInput,
): Promise<void> {
  ensurePeopleRegistrations();
  const at = instant(actor);

  await requirePermission(
    actor.principal,
    "people.update",
    { person: personId },
    { at },
  );

  const data = {
    givenName: requiredText("givenName", input.givenName, TEXT_MAX.name),
    familyName: requiredText("familyName", input.familyName, TEXT_MAX.name),
    dateOfBirth: optionalDate("dateOfBirth", input.dateOfBirth),
    email: optionalText("email", input.email, TEXT_MAX.email),
    phone: optionalText("phone", input.phone, TEXT_MAX.phone),
  };

  await prisma.$transaction(async (tx) => {
    const before = await tx.person.findUnique({
      where: { id: personId },
      select: {
        givenName: true,
        familyName: true,
        dateOfBirth: true,
        email: true,
        phone: true,
      },
    });
    if (!before) return;

    // The NAMES of what actually changed, computed by comparison so the trail
    // says "the date of birth changed" rather than "somebody submitted the
    // form". Values are never compared into the record — only the names.
    const changed = (
      ["givenName", "familyName", "dateOfBirth", "email", "phone"] as const
    ).filter((field) => {
      const left = before[field];
      const right = data[field];
      if (left instanceof Date || right instanceof Date) {
        return (
          (left as Date | null)?.getTime() !== (right as Date | null)?.getTime()
        );
      }
      return left !== right;
    });

    if (changed.length === 0) return;

    await tx.person.update({ where: { id: personId }, data });

    await recordAuditEvent(
      {
        eventType: "people.person.updated",
        outcome: "SUCCESS",
        actorPersonId: actor.principal.personId,
        actorAuthMethod: "session",
        targetType: "person",
        targetId: personId,
        requestId: actor.requestId ?? null,
        changedFields: {
          fields: changed.join(","),
          dateOfBirthKnown: data.dateOfBirth !== null,
        },
      },
      tx,
    );
  });
}
