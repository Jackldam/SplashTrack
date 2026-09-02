/**
 * Hand-maintained classification of EVERY Prisma field that references a
 * `Person` — a `personId` / `*PersonId` scalar column, or a relation field
 * typed `Person` / `Person?` — across the whole schema.
 *
 * ADOPTED FROM THE TEMPLATE (D-135), not re-invented. `05-technical.md` §5.1
 * corrects the design on this point: D-014 describes "a registry with a test
 * asserting every `Person`-referencing table appears in it" as something to
 * CREATE. It already existed, and it is checked BIDIRECTIONALLY —
 * `tests/unit/person-reference-sync.test.ts` reads `prisma/schema.prisma`
 * directly and fails if a schema column has no entry here (an undocumented,
 * possibly-unhandled Person reference) AND if an entry here has no matching
 * schema column (a stale entry after a rename or removal).
 *
 * THE CONSEQUENCE IS A FORCING FUNCTION, AND IT BELONGS IN THE DEFINITION OF
 * DONE RATHER THAN IN A CI SURPRISE (`06-delivery.md` §4.4): the build goes red
 * the moment a domain model adds a `Person` reference without an entry here.
 * That is the desired behaviour. In a system holding children's records, an
 * erasure that silently misses a column is the failure this exists to prevent —
 * and in the template it happened twice, in ways nothing else would have
 * caught: `OrganizationBranding.updatedByPersonId` had a `Restrict` foreign key
 * with no sever step, so erasing that editor rolled back the WHOLE transaction;
 * and `MaintenanceJob.updatedByPersonId` was never referenced by the erasure
 * repository at all — no foreign key, so erasure "succeeded" while leaving the
 * erased person's id on the row forever. Neither would have failed a migration
 * or a typecheck.
 *
 * PHASE 0.4: the ERASURE PATH this classifies does not exist yet. `erasePersonData`
 * and the retention/erasure registry are D-014/D-065 work, blocked on the
 * repaired specification. What exists today is the classification and the test
 * that keeps it honest — which is the right order round: the map must be
 * accurate before anything is written against it.
 *
 * Categories:
 *   HARD_DELETE      — the row is the person's OWN data. The erasure deletes it
 *                      explicitly (its FK to Person is `onDelete: Restrict`, so
 *                      this step is MANDATORY — there is no cascade to fall
 *                      back on).
 *   CASCADES         — the person's own data AND the FK is `onDelete: Cascade`,
 *                      so the database would remove it automatically.
 *   SEVER_AND_RETAIN — NOT the person's own data (operator content, or
 *                      accountability evidence). Only the personal-id LINK is
 *                      nulled; the row itself survives.
 *   RETAIN_BY_DESIGN — the plain id token is left AS-IS, forever, by deliberate
 *                      choice. MUST carry a `reason` (enforced by the sync
 *                      test) — this is the category it is easiest to hide a
 *                      silent leak behind, so every entry justifies itself in
 *                      writing.
 *
 * Keyed `"<Model>.<field>"`, matching every model/field pair the sync test
 * extracts from the schema.
 */

export type PersonReferenceCategory =
  "HARD_DELETE" | "CASCADES" | "SEVER_AND_RETAIN" | "RETAIN_BY_DESIGN";

export interface PersonReferenceClassification {
  category: PersonReferenceCategory;
  /** Why this row is classified this way. Mandatory for RETAIN_BY_DESIGN. */
  reason: string;
}

export const PERSON_REFERENCE_CLASSIFICATION: Record<
  string,
  PersonReferenceClassification
> = {
  // --- HARD_DELETE — the person's own data (Restrict FK, explicit delete) ---
  "UserAccount.personId": {
    category: "HARD_DELETE",
    reason:
      "The account IS the person's sign-in identity. The FK is deliberately " +
      "onDelete: Restrict, never a silent cascade; the erasure deletes it " +
      "explicitly before the Person row. That in turn cascades Session / " +
      "Account (the password hash) / TwoFactor / Passkey via userId — those " +
      "reference UserAccount, not Person, so they are out of this map.",
  },
  "OrganizationMembership.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own membership row. Restrict FK; an explicit deleteMany " +
      "in the erasure. NOTE for phase 0.3: when this table becomes " +
      "`Membership`, the SplashTrack domain concept of club membership " +
      "(D-059, with MembershipPeriod history) is NOT this row, and its " +
      "retention is a separate decision — a diploma history outliving a " +
      "membership is the whole point of D-053's split.",
  },
  "RoleAssignment.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own role grant. Restrict FK; an explicit deleteMany in " +
      "the erasure.",
  },
  "PlatformRoleAssignment.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own platform-wide role grant. Restrict FK; an explicit " +
      "deleteMany in the erasure. PHASE 0.3 deletes this model entirely — " +
      "there is no platform super administrator in SplashTrack (D-056) — and " +
      "this entry goes with it.",
  },

  // --- SEVER_AND_RETAIN — not the person's own data; only the link is nulled ---
  "PlatformSettings.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "A last-editor accountability pointer on the settings singleton. The FK " +
      "is onDelete: SetNull as defence in depth; the erasure severs it " +
      "explicitly regardless. Both, deliberately: the explicit sever is the " +
      "control, and SetNull is what stops a FUTURE delete path that forgets " +
      "the sever from rolling back an entire erasure — which is exactly what " +
      "the sibling column in the template did before it was fixed.",
  },
  "ApiCredential.createdByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "The administrator who minted the credential — accountability only. The " +
      "credential is a live, permission-managed asset that stays usable after " +
      "its creator is erased; a plain token, no FK. The erasure severs it " +
      "explicitly. There is no code reading this table yet " +
      "(`05-technical.md` §4 keeps API credentials in place, unused), which " +
      "is precisely why it needs a classification now rather than when " +
      "someone finally writes to it.",
  },

  // --- RETAIN_BY_DESIGN — the id token is kept, forever, on purpose ---
  "AuditEvent.actorPersonId": {
    category: "RETAIN_BY_DESIGN",
    reason:
      "Article 17(3) security and accountability: the tamper-evident audit " +
      "trail must OUTLIVE the entities it references, so this column is " +
      "deliberately NOT a foreign key and is NEVER severed or deleted on " +
      "erasure. Severing it would also break the hash chain — actorPersonId " +
      "is inside the canonicalized content every row's hash commits to, so an " +
      "UPDATE here makes the trail report itself as tampered with. The " +
      "erasure's own event retains the erased person's id as targetId under " +
      "this same rule.",
  },
};
