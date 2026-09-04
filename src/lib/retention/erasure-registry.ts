/**
 * The D-014 erasure registry, completed per D-154.
 *
 * D-014: erasure is one transaction with an explicit table registry, and a
 * test asserts every table referencing `Person` appears in it — so forgetting
 * a table is unmergeable, not merely undocumented.
 *
 * D-154's correction: `AuditEvent` references `Person` (`actorPersonId`) and is
 * simultaneously append-only and never deleted or updated by application code.
 * Both cannot hold under a registry whose only entry kind is "erase this row's
 * pointer" — either erasure mutates the accountability record the product
 * thesis rests on, or `AuditEvent` is silently absent from the registry whose
 * whole point is that absence is unmergeable. So the registry has TWO entry
 * kinds, and every table has exactly one:
 *
 *   - `erase`   — the default. This table's `Person` pointer(s) are handled by
 *                 `PERSON_REFERENCE_CLASSIFICATION` (HARD_DELETE / CASCADES /
 *                 SEVER_AND_RETAIN) at the column level, per D-065's policy for
 *                 the table's own `DataClass`.
 *   - `exempt`  — the whole table is carved out of the erasure mechanism, with
 *                 a lawful ground and an expiry NAMED IN THIS FILE — visible in
 *                 the registry and enumerated in the erasure report given to
 *                 the data subject, never a silent omission.
 *
 * NOT the same axis as `PERSON_REFERENCE_CLASSIFICATION`. That file answers
 * "what happens to THIS COLUMN" (a pointer FROM some other row TO the erased
 * person). This file answers "is this TABLE's participation in erasure normal,
 * or is the whole table exempted." `AuditEvent.actorPersonId` is classified
 * `RETAIN_BY_DESIGN` there (never severed) *because* `AuditEvent` is `exempt`
 * here — the two files agree by construction, and
 * `tests/unit/erasure-registry-sync.test.ts` checks the schema side.
 *
 * TWO PHASE-1.1 TABLES ARE DELIBERATELY ABSENT, and their absence is checked
 * rather than assumed. `MembershipPeriod` and `StudentLifecycleEvent` reference
 * no `Person` — they reference `Membership` and `StudentProfile`, which do — so
 * the completeness test neither requires nor permits an entry for them (its
 * third assertion refuses a registered model that does not reference `Person`).
 * They leave by CASCADE when the row they belong to is erased, which is why
 * their foreign keys are the only `onDelete: Cascade` edges in the domain half
 * of the schema. Recorded here because "no entry" and "forgotten" look identical
 * from the outside, and this file's whole premise is that they must not.
 *
 * `Charge` and `Payment` are NOT yet in this registry — the `fees` module has
 * not been extracted (no such tables exist in `prisma/schema.prisma` yet).
 * D-092/D-154 already describe their shape: `exempt("fiscal administration
 * (Dutch Boekhoudverplichting, 7 years)", ...)`. Add them here the day the
 * tables land; do not let a new Person-referencing financial table go
 * unclassified in the meantime — the completeness test will refuse to let it.
 *
 * `erasePersonData`, the transaction that actually WALKS this registry, is not
 * built yet (`docs/build/phase-0.4b-reach-and-retention-report.md` §3) —
 * v1 does not ship the D-120 policy engine, and R-25 is where the transaction
 * and the scheduled retention job land. This file is the registry the future
 * transaction reads, kept complete from today so it never has to be built
 * against an unaudited set of tables.
 */

export type ErasureRegistryEntry =
  | { readonly kind: "erase" }
  | {
      readonly kind: "exempt";
      /** The lawful ground, stated in writing (D-154) — never an absence. */
      readonly ground: string;
      /**
       * What ends the exemption. A description of the mechanism/trigger, not a
       * fixed date — `AuditEvent`'s bound is D-168's COMPUTED floor
       * (`computeAuditRetentionFloorDays`), which changes as other classes'
       * retention changes and cannot be a literal `Date` here.
       */
      readonly until: string;
    };

export const ERASURE_REGISTRY: Readonly<Record<string, ErasureRegistryEntry>> =
  {
    Organization: { kind: "erase" },
    UserAccount: { kind: "erase" },
    Membership: { kind: "erase" },
    StudentProfile: { kind: "erase" },
    PersonRelationship: { kind: "erase" },
    RoleAssignment: { kind: "erase" },
    ApiCredential: { kind: "erase" },
    CredentialRoleAssignment: { kind: "erase" },
    RetentionPolicy: { kind: "erase" },
    AuditEvent: {
      kind: "exempt",
      ground:
        "Art. 5(2) accountability — the controller must be able to demonstrate " +
        "compliance, which requires an intact record of who did what. Supported, " +
        "where a specific dispute exists, by Art. 17(3)(e) (establishment, " +
        "exercise or defence of legal claims). Severing actorPersonId would also " +
        "break the tamper-evidence hash chain, since the field is inside the " +
        "canonicalised content every row's hash commits to (D-149).",
      until:
        "Never by erasure. Rows leave only through pruneAuditEventPrefix, which " +
        "deletes a contiguous expired PREFIX and writes the covering " +
        "AuditCheckpoint in the same transaction, bounded by " +
        "computeAuditRetentionFloorDays() (D-168 rule 6) — never below " +
        "AUDIT_RETENTION_ABSOLUTE_FLOOR_DAYS.",
    },
  };
