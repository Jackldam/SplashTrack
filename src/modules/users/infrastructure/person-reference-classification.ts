/**
 * Hand-maintained classification of EVERY Prisma field that references a
 * `Person` — a `personId`/`*PersonId` scalar column, or a relation field typed
 * `Person`/`Person?` — across the whole schema. This is the single source of
 * truth `tests/unit/person-reference-sync.test.ts` checks against
 * `prisma/schema.prisma` directly, in BOTH directions: a schema column with no
 * entry here fails the test (an undocumented, possibly-unhandled Person
 * reference), and an entry with no matching schema column fails too (a stale
 * entry after a rename/removal).
 *
 * This is the Person-erasure analogue of `ORG_SCOPED_MODELS` /
 * `ORG_SCOPE_EXEMPT_MODELS` (`src/lib/database/organization-scope.ts`) — same
 * root cause, same fix: the recently-fixed `OrganizationBranding` erasure bug
 * (a `Restrict` FK with no sever step rolled back an entire Art. 17 erasure)
 * and the `MaintenanceJob.updatedByPersonId` gap (no FK, no sever step,
 * `person-erasure-repository.ts` never referenced the model at all) both
 * happened because NOTHING forced a reviewed decision when the column was
 * added. This map — and the sync test — is that forcing function, for every
 * Person-referencing column, going forward.
 *
 * Categories:
 *   HARD_DELETE      — the row is the person's OWN data. `erasePersonData`
 *                       deletes it explicitly (its FK to Person is
 *                       `onDelete: Restrict`, so this step is MANDATORY —
 *                       there is no cascade to fall back on).
 *   CASCADES         — the row is the person's own data AND the FK is
 *                       `onDelete: Cascade`, so the database would remove it
 *                       automatically even without an explicit step. Still
 *                       deleted explicitly today (for an accurate count / an
 *                       up-front `requireOrphaned` check), but the row's
 *                       removal does not depend on that.
 *   SEVER_AND_RETAIN — the row is NOT the person's own data (org/platform/
 *                       operator content, or accountability/consent
 *                       evidence). Only the personal-id LINK is nulled; the
 *                       row itself survives.
 *   RETAIN_BY_DESIGN — the plain id token is left AS-IS, forever, by
 *                       deliberate choice. MUST carry a `reason` (enforced by
 *                       the sync test) — this is the category it is easiest
 *                       to hide a silent leak behind, so every entry must
 *                       justify itself in writing.
 *
 * Keyed `"<Model>.<field>"`, matching every model/field pair
 * `person-reference-sync.test.ts` extracts from the schema.
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
      "The account IS the person's login identity. FK is deliberately " +
      "onDelete: Restrict (never a silent cascade); erasePersonData deletes " +
      "it explicitly before the Person row. This in turn cascades Session / " +
      "Account (password hash) / TwoFactor / Passkey / EmailVerificationToken " +
      "via userId/userAccountId — those reference UserAccount, not Person, " +
      "so they are out of this map.",
  },
  "OrganizationMembership.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own membership row. Restrict FK; explicit deleteMany in " +
      "erasePersonData (Section 18.2).",
  },
  "RoleAssignment.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own org-scoped role grant. Restrict FK; explicit " +
      "deleteMany in erasePersonData.",
  },
  "PlatformRoleAssignment.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own platform-wide role grant. Restrict FK; explicit " +
      "deleteMany in erasePersonData.",
  },
  "PersonProfileFieldValue.personId": {
    category: "HARD_DELETE",
    reason:
      "The person's own custom-profile-field values. Restrict FK (Section " +
      "18.2): an erasure must delete these EXPLICITLY, never as an accidental " +
      "cascade side effect. Explicit deleteMany in erasePersonData.",
  },

  // --- CASCADES — own data, but the FK itself would remove it automatically ---
  "PendingInvitation.personId": {
    category: "CASCADES",
    reason:
      "The person's own pending invitation. FK is onDelete: Cascade, so the " +
      "database removes this row automatically when the Person row is " +
      "deleted. erasePersonData ALSO deletes it explicitly first (its count " +
      "feeds the requireOrphaned check for the invitation-revoke caller, " +
      "which must see zero pending invitations BEFORE erasing) — but the " +
      "row's survival does not depend on that explicit step.",
  },

  // --- SEVER_AND_RETAIN — not the person's own data; only the link is nulled ---
  "Consent.personId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Art. 7 / 17(3) accountability: the fact a consent was given/withdrawn " +
      "for a purpose/version is retained, detached from the person. Nullable, " +
      "Restrict FK (a direct delete attempt outside erasure is still " +
      "blocked); erasePersonData severs it explicitly (personId -> null).",
  },
  "UploadedAsset.uploadedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "A SHARED asset (e.g. a branding logo) is org/platform data; only the " +
      "'uploaded by' link is personal. The person's OWN avatar asset(s) are " +
      "matched separately by id and HARD-deleted (row + external bytes) — " +
      "they never reach this sever path. Nullable, Restrict FK; explicit " +
      "updateMany sever in erasePersonData.",
  },
  "PlatformSettings.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Last-editor accountability pointer on the platform settings " +
      "singleton — same class as the other operator-config pointers below. " +
      "FK changed onDelete: Restrict -> SetNull 2026-08-03 (defense-in-depth, " +
      "mirroring OrganizationBranding.updatedByPersonId below); " +
      "erasePersonData severs it explicitly regardless.",
  },
  "OrganizationBranding.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Per-org branding last-editor pointer (ADR-017). FK is onDelete: " +
      "SetNull (fixed 2026-08-03, defense-in-depth) — before that fix it was " +
      "Restrict with no sever step, and erasing a person who last edited ANY " +
      "org's branding rolled back the WHOLE erasure transaction. " +
      "erasePersonData severs it explicitly regardless of the FK action.",
  },
  "CustomPage.createdByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Operator-authored page content (ADR-015) is retained; only the " +
      "author pointer is nulled. Plain token, no FK by design (so erasure " +
      "never depends on a sever step succeeding before the delete) — " +
      "explicit updateMany sever in erasePersonData.",
  },
  "CustomPage.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Same as CustomPage.createdByPersonId above, for the last-editor " +
      "pointer (a person may be the creator of one page and the last editor " +
      "of another, so both are severed independently).",
  },
  "EmailTemplate.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Last-editor pointer on a seeded, operator-edited template row " +
      "(ADR-030) — same class as CustomPage/PlatformSettings above. Plain " +
      "token, no FK; explicit updateMany sever in erasePersonData.",
  },
  "ApiCredential.createdByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "The admin who minted the credential (ADR-020) — accountability only. " +
      "The credential is a live, org-owned, permission-managed asset that " +
      "stays usable after the creator is erased; plain token, no FK. " +
      "erasePersonData severs it explicitly and the org's credential admins " +
      "are notified afterwards so a now-creator-less credential can be " +
      "reviewed/revoked.",
  },
  "MaintenanceJob.updatedByPersonId": {
    category: "SEVER_AND_RETAIN",
    reason:
      "Last-editor pointer for a maintenance job's enabled/intervalMinutes " +
      "config — same class as the other operator-config last-editor " +
      "pointers above. Gap fixed 2026-08-03 (this program): previously " +
      "unhandled — plain token, no FK, and person-erasure-repository.ts never " +
      "referenced the MaintenanceJob model at all, so an erased person's id " +
      "lingered on the row forever. Now severed explicitly.",
  },

  // --- RETAIN_BY_DESIGN — the id token is kept, forever, on purpose ---
  "AuditEvent.actorPersonId": {
    category: "RETAIN_BY_DESIGN",
    reason:
      "Art. 17(3) security/accountability: the tamper-evident audit trail " +
      "must OUTLIVE the entities it references, so this column is " +
      "deliberately NOT an FK and is NEVER severed or deleted on erasure. " +
      "The erasure's own `data_subject.erased` event retains the erased " +
      "person's id as targetId under this exact rule.",
  },
  "PlatformBootstrap.personId": {
    category: "RETAIN_BY_DESIGN",
    reason:
      "A one-time, single-row historical marker of who performed the " +
      "(unrepeatable, database-race-guarded) platform-bootstrap action — " +
      "recorded, per the model doc, 'purely so the bootstrap event can be " +
      "logged/traced'. Same accountability rationale as " +
      "AuditEvent.actorPersonId, at negligible severity: exactly one row " +
      "ever exists, no live functionality reads this column once " +
      "`completedAt` is set, and it carries no FK. Decided NOT to sever: the " +
      "pointer records a permanent historical fact ('this person bootstrapped " +
      "this platform'), not live operational state, so adding a sever step " +
      "would be speculative hardening for a table written exactly once.",
  },
};
