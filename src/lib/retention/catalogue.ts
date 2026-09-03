/**
 * The shipped retention catalogue — `01-domain-model.md` §5, as executable data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ENTRY HERE IS A PROPOSAL (F-27)
 *
 * §5's own opening: *"All retention below is a **default proposal**, not a rule
 * we impose."* The organisation is the controller (D-064) and must decide its
 * own grounds; we ship defaults *"clearly marked as requiring the organisation's
 * own confirmation"*.
 *
 * That is why `proposedLawfulBasis` is a column and `confirmedLawfulBasis` is a
 * separate, nullable one that **this file never populates**. Seeding a
 * confirmation would be recording a decision nobody made — worth less than the
 * honest blank it replaces, which is the same reason §5.6 rejects blocking the
 * setup wizard until thirteen legal questions are answered.
 *
 * Where §5 gives no basis, the proposal is `UNRESOLVED` and prints as unresolved
 * (D-110, F-128). The diagnostics page and the privacy screen name the count of
 * unresolved bases and overdue reviews: visible and slightly annoying beats
 * silent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON `REVIEW`, HONESTLY (§5.6)
 *
 * Seven classes default to `REVIEW`, and `REVIEW` means *nothing happens
 * automatically*. v1 does not ship the policy engine (D-120), so `REVIEW` here
 * is a documented "we do not delete this automatically" and not a queue. Saying
 * so is better than shipping a queue nobody opens and calling it a mechanic.
 */
import type {
  DataClass,
  LawfulBasis,
  OnExpiry,
  RetentionTrigger,
} from "@/generated/prisma/client";

const DAY = 1;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export interface RetentionProposal {
  readonly dataClass: DataClass;
  readonly purpose: string;
  readonly proposedLawfulBasis: LawfulBasis;
  readonly trigger: RetentionTrigger;
  /** Null = "as long as needed for the purpose"; only honest with `REVIEW`. */
  readonly retainForDays: number | null;
  readonly onExpiry: OnExpiry;
  /** Required exactly when `onExpiry` is `ANONYMISE` (D-155). */
  readonly anonymisedAggregate?: string;
  /** Do audit events evidence changes to this class? Feeds D-168 rule 6. */
  readonly evidencedByAudit: boolean;
  /** Where this row comes from, so a reader can check it against the chapter. */
  readonly source: string;
}

/**
 * The catalogue. Ordered as §5's table orders it, then the four classes this
 * schema needs and that chapter never listed.
 */
export const RETENTION_CATALOGUE: readonly RetentionProposal[] = [
  {
    dataClass: "PERSON_IDENTITY",
    purpose:
      "Identifying the people the organisation deals with — pupils, guardians, " +
      "staff, examiners — for as long as any relationship with them exists.",
    proposedLawfulBasis: "CONTRACT",
    // D-066: the end of the LAST relationship of any kind, never membership.
    // The most common person in the database has no membership at all.
    trigger: "LAST_RELATIONSHIP_END",
    retainForDays: 24 * MONTH,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5, §5.1 (D-066)",
  },
  {
    dataClass: "LOGIN_CREDENTIALS",
    purpose:
      "Authenticating an account holder. Password hashes, sessions, TOTP " +
      "enrolments and passkeys.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "ACCOUNT_CLOSED",
    retainForDays: null,
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 — 'Immediate' on account closure",
  },
  {
    dataClass: "MEMBERSHIP_PERIODS",
    purpose:
      "Recording who was a member of the club and when, including for the " +
      "fiscal administration that depends on it.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "LAST_MEMBERSHIP_PERIOD_END",
    retainForDays: 7 * YEAR,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "ROLE_ASSIGNMENTS",
    purpose:
      "Recording who was authorised to do what, over which resources, when, " +
      "and on whose authority — the evidence behind every audited action, and " +
      "what §2.6's anti-amplification rule is checked against after the fact.",
    // NOT IN §5'S TABLE. Unresolved rather than guessed: a grant's retention
    // plausibly follows the audit floor (it is what an audit event's actor id
    // means) or the person's, and that is the organisation's call, not ours.
    proposedLawfulBasis: "UNRESOLVED",
    trigger: "LAST_RELATIONSHIP_END",
    retainForDays: null,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "Not in §5 — added by phase 0.4b; see the report §3",
  },
  {
    dataClass: "STUDENT_PROFILE",
    purpose: "Administering a pupil's lessons, groups and progress.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "LAST_ENROLMENT_END",
    retainForDays: 24 * MONTH,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "MEDICAL_NOTES",
    purpose:
      "Keeping a child safe in the water — an instructor who does not know " +
      "about a condition cannot act on it (D-176, D-177).",
    // Art. 9(2)(a). D-177 makes 'voluntary and withdrawable' true in the schema
    // rather than in a promise.
    proposedLawfulBasis: "EXPLICIT_CONSENT",
    trigger: "LAST_ENROLMENT_END",
    retainForDays: 12 * MONTH,
    // Never anonymise. §5.3's whole-class rule: hard-deleted from LIVE storage
    // at 12 months — and the privacy notice must also state the backup horizon,
    // because a deleted row can still sit in an already-taken encrypted backup
    // until that backup ages out (F-104).
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5; 02-security-privacy.md §5.3",
  },
  {
    dataClass: "ASSESSMENT_REMARKS",
    purpose: "Teaching: what a pupil needs to work on next.",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "ASSESSMENT_DATE",
    retainForDays: 12 * MONTH,
    // D-087: a developmental observation about a minor's body. In the protected
    // free-text class (D-148) and deleted, never anonymised.
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 (D-087)",
  },
  {
    dataClass: "ATTENDANCE_EVENTS",
    purpose:
      "Performing the teaching agreement, and answering 'was my child there?'.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "SESSION_DATE",
    retainForDays: 24 * MONTH,
    // D-111/F-48: DELETE, not anonymise. Stripping `studentProfileId` while
    // keeping `sessionId` and the timestamps does not produce anonymous data
    // against twelve-child groups with retained memberships and known session
    // dates. Any aggregate worth keeping is COMPUTED and stored first.
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5.3 (D-111); 02-… §5.6 (D-155)",
  },
  {
    dataClass: "SKILL_PROGRESS",
    purpose: "The pupil's learning record, and the evidence behind a diploma.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "ACHIEVEMENT_DATE",
    retainForDays: 7 * YEAR,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "ASSESSMENT_RESULTS",
    purpose:
      "The formal outcome of an aftest or assessment, and the basis on which a " +
      "pupil was or was not admitted to an exam.",
    proposedLawfulBasis: "CONTRACT",
    trigger: "ASSESSMENT_DATE",
    retainForDays: 7 * YEAR,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "EXAM_RESULTS_AND_AWARDS",
    purpose: "The diploma register: who earned which award, and when.",
    // §5.2, stated as honestly as the chapter states it: an erasure request does
    // NOT automatically lose to a diploma register. A ground must be identified
    // per organisation, and many swim schools will have none — in which case the
    // award record is deleted or genuinely anonymised like anything else.
    proposedLawfulBasis: "UNRESOLVED",
    trigger: "AWARD_ISSUE",
    // "10 years ONLY where a retention ground applies" — the number is the
    // proposal, and the ground is what makes it lawful.
    retainForDays: 10 * YEAR,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5, §5.2 (F-06 revised)",
  },
  {
    dataClass: "CHARGES",
    purpose: "Fiscal administration: what was owed, by whom, for what.",
    proposedLawfulBasis: "LEGAL_OBLIGATION",
    trigger: "CHARGE_DUE_DATE",
    retainForDays: 7 * YEAR,
    // §5 says PSEUDONYMISE (D-092). That is not one of D-065's three actions,
    // and D-154 itself reads those two rows as an ERASURE EXEMPTION on a
    // financial ground rather than as an expiry action. So: REVIEW here, and
    // `exempt("fiscal administration", 7 years)` in the erasure registry, which
    // is where 'retained, pseudonymised' actually happens. Report §3.
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 (D-092), reconciled with D-065/D-154/D-155",
  },
  {
    dataClass: "PAYMENTS",
    purpose: "Fiscal administration: what was paid, by whom, when.",
    proposedLawfulBasis: "LEGAL_OBLIGATION",
    trigger: "PAYMENT_RECEIVED_DATE",
    retainForDays: 7 * YEAR,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 (D-092), reconciled with D-065/D-154/D-155",
  },
  {
    dataClass: "CONSENT_RECORDS",
    purpose:
      "Demonstrating, under Art. 5(2), the basis on which the organisation " +
      "acted — including which wording was agreed to and by whom (D-063).",
    proposedLawfulBasis: "LEGAL_OBLIGATION",
    trigger: "CONSENT_WITHDRAWN_OR_PURPOSE_EXPIRED",
    retainForDays: null,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 (D-063)",
  },
  {
    dataClass: "AUDIT_EVENTS",
    purpose:
      "Security, and Art. 5(2) accountability: who did what to whom, and when.",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "EVENT_DATE",
    // NOT a typed number. D-168 rule 6: the floor is COMPUTED as
    // `max(12 months, the longest configured retention among the classes these
    // events evidence)`, so that an operator does not have to keep two numbers
    // in step. `computeAuditRetentionFloorDays()` is that computation, and it is
    // why this entry is the one with a null duration and `evidencedByAudit:
    // false` — a class cannot be its own floor.
    retainForDays: null,
    // Prefix-only and checkpointed (D-168) — `pruneAuditEventPrefix` is the only
    // delete path, and a gap no checkpoint covers is the tampering signal.
    onExpiry: "DELETE",
    evidencedByAudit: false,
    source: "01-domain-model.md §5; 02-security-privacy.md §3.2.1 (D-168)",
  },
  {
    dataClass: "INQUIRIES",
    purpose: "Responding to a message sent through the public website.",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "SUBMISSION",
    retainForDays: 6 * MONTH,
    // In the protected free-text class (D-148): the first message a parent sends
    // very often volunteers a child's health (§5.3, F-115).
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5; 02-… §5.3",
  },
  {
    dataClass: "WAITLIST_ENTRIES",
    purpose:
      "Placing a request for a lesson place — one list for the whole club, " +
      "matched against groups that have room (D-180).",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "PLACEMENT_OR_WITHDRAWAL",
    retainForDays: 12 * MONTH,
    onExpiry: "DELETE",
    evidencedByAudit: true,
    source: "01-domain-model.md §5 (D-180)",
  },
  {
    dataClass: "OPERATIONAL_LOGS",
    purpose:
      "Operations and troubleshooting. Opaque identifiers only, no PII (§5.7).",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "RECORD_CREATION",
    retainForDays: 30 * DAY,
    onExpiry: "DELETE",
    evidencedByAudit: false,
    source: "01-domain-model.md §5; 02-… §5.7",
  },
  {
    dataClass: "PRE_MIGRATION_BACKUPS",
    purpose:
      "Recoverability across an unattended migration — the most dangerous " +
      "moment in this product's life (D-044).",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "MIGRATION_RUN",
    // F-49: D-044's automatic backup had NO retention policy at all, so a full
    // copy of the database including medical notes accumulated once per upgrade
    // and outlived every rule in the table. Deleted after the next successful
    // start; at most three retained. The COUNT cap is the operative rule and
    // lives with the backup code; the duration here is its outer bound.
    retainForDays: 90 * DAY,
    onExpiry: "DELETE",
    evidencedByAudit: false,
    source: "01-domain-model.md §5 (D-044, D-104, F-49)",
  },
  {
    dataClass: "PUBLIC_PAGE_CONTENT",
    purpose: "The public website. No personal data (D-051, D-017).",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "NOT_APPLICABLE",
    retainForDays: null,
    onExpiry: "REVIEW",
    evidencedByAudit: false,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "ORGANIZATION_SETTINGS",
    purpose:
      "The instance's own configuration, roles, permissions and units. No " +
      "personal data beyond severed accountability pointers.",
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "NOT_APPLICABLE",
    retainForDays: null,
    onExpiry: "REVIEW",
    evidencedByAudit: false,
    source: "01-domain-model.md §5",
  },
  {
    dataClass: "RATE_LIMIT_COUNTERS",
    purpose:
      "Throttling and lockout on login, MFA verification, password reset, " +
      "export, public forms and the setup and recovery tokens (D-101, D-115, " +
      "F-117). Keys are HASHED identifiers, never a raw email or IP address.",
    // NOT IN §5'S TABLE.
    proposedLawfulBasis: "LEGITIMATE_INTEREST",
    trigger: "RECORD_CREATION",
    retainForDays: 30 * DAY,
    onExpiry: "DELETE",
    evidencedByAudit: false,
    source: "Not in §5 — added by phase 0.4b; see the report §3",
  },
  {
    dataClass: "API_CREDENTIALS",
    purpose:
      "Machine callers, and who minted them. No integration exists in v1 " +
      "(D-163) — the table is kept in place and unused (`05-technical.md` §4).",
    // NOT IN §5'S TABLE.
    proposedLawfulBasis: "UNRESOLVED",
    trigger: "RECORD_CREATION",
    retainForDays: null,
    onExpiry: "REVIEW",
    evidencedByAudit: true,
    source: "Not in §5 — added by phase 0.4b; see the report §3",
  },
];

/**
 * The outer bound on any configured retention — D-150's *"any retention ≤ the
 * platform maximum"*.
 *
 * **The number is mine and the design does not state one.** D-150 names the
 * ceiling and no chapter gives it a value. 30 years is chosen to be far above
 * every default in the catalogue (the longest is 10 years) while still refusing
 * the value a data-entry accident actually produces — `9999`, or a century.
 * It exists to make "retain forever" an explicit `null` rather than a large
 * integer nobody meant to type.
 *
 * It lives in code and not in a CHECK constraint deliberately: D-150 classifies
 * this as a `bounded` setting, whose bound is *"enforced by the setting's own
 * schema"*, and raising a ceiling must not require a migration.
 */
export const PLATFORM_MAXIMUM_RETENTION_DAYS = 30 * YEAR;

/** D-168 rule 6's floor for the audit trail itself: never below twelve months. */
export const AUDIT_RETENTION_ABSOLUTE_FLOOR_DAYS = 12 * MONTH;
