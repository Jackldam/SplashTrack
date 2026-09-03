/**
 * The encrypted-column registry (D-167). One entry per column whose value is
 * stored under the D-096 envelope.
 *
 * WHY THIS FILE EXISTS AT ALL. D-096 as first written bound the envelope's AAD
 * to the physical table and column name. Two of its four components were
 * identifiers this design had already committed to changing — D-159 makes every
 * schema identifier English *without exception*, D-100 renames
 * `PlatformBootstrap`, D-056 merged `PlatformSettings` away — so renames were
 * SCHEDULED, not hypothetical. A rename changes the AAD, and a changed AAD
 * fails authentication indistinguishably from the tampering the AAD exists to
 * detect. Neither mechanism that looks like it would catch that does:
 * `key:rotate` is keyed by `keyId`, which a rename does not change, and R-20
 * runs migrations unattended at container start, AFTER the pre-migration
 * backup — so the backup holds ciphertext bound to the old names and the
 * running instance can read neither. Finding F-136.
 *
 * D-167's answer: the AAD binds a stable `columnId` from this registry, and
 * `model`/`field` become ordinary MUTABLE columns of the registry entry. A
 * rename edits those two and leaves `columnId` alone, so no ciphertext is
 * disturbed.
 *
 * THE THREE RULES THAT MAKE THAT TRUE:
 *
 *   1. **A `columnId` is assigned once and never changes.** It is not derived
 *      from the model or the field name. The vocabulary is permanent — a typo
 *      in one is a name we live with forever, which is the trade-off D-167
 *      accepts knowingly.
 *   2. **A `columnId` is never reused for a different column.** Reuse is
 *      precisely the ciphertext portability D-096 exists to prevent: with the
 *      same `columnId` and the same primary key, one row's value authenticates
 *      in another column.
 *   3. **The primary key stays in the AAD**, so a value cannot be copied
 *      between rows. That is not obtainable from anything stable by
 *      construction, so it comes with an obligation instead:
 *
 * **ANY MIGRATION THAT CHANGES A ROW'S PRIMARY KEY, SPLITS A TABLE, OR MOVES AN
 * ENCRYPTED VALUE TO ANOTHER ROW MUST DECRYPT WITH THE OLD `(columnId, pk)` AND
 * RE-ENCRYPT WITH THE NEW ONE, INSIDE THE SAME MIGRATION.** A rename alone is
 * safe by construction and needs nothing. `05-technical.md` §5 rule 6 states
 * this once; `tests/unit/migration-safety.test.ts` enforces that a migration
 * touching a registered model declares which of the two cases it is.
 *
 * HOW A COLUMN GETS HERE. Mark the field in `prisma/schema.prisma` with a
 * `/// @encrypted <columnId>` doc comment and add the matching entry below.
 * `tests/unit/encrypted-column-registry.test.ts` checks both directions —
 * every marker has an entry, every entry has a marker — in the shape D-135
 * already adopts for `person-reference-sync.test.ts`. A rename that forgets the
 * mapping fails the build rather than the decryption.
 */

import type { KeyPurpose } from "./secret-key";

export interface EncryptedColumnEntry {
  /**
   * The stable logical identifier. PERMANENT: it is bound into the AAD of every
   * ciphertext ever written for this column. Lower snake case, `<area>.<name>`.
   */
  readonly columnId: string;
  /** Prisma model holding the column. MUTABLE — a rename edits this. */
  readonly model: string;
  /** Prisma field name. MUTABLE — a rename edits this. */
  readonly field: string;
  /** HKDF purpose label the column's key derives under (D-112). */
  readonly purpose: KeyPurpose;
  /**
   * Set on entries that exist for the committed golden vectors (D-097) and name
   * no schema column. The registry sync test asserts these resolve to nothing
   * in `prisma/schema.prisma`, so a fixture can never quietly become the
   * binding for a real column.
   */
  readonly fixture?: true;
  /** Why this column is encrypted, in one line. */
  readonly note: string;
}

/**
 * THE REGISTRY. Keyed by `columnId` so a duplicate is a syntax error rather
 * than a review miss.
 *
 * IT HOLDS NO PRODUCTION COLUMN YET, AND THAT IS THE POINT OF THE ORDERING.
 * `CLAUDE.md` rule 1 is that the envelope exists before the first encrypted
 * byte — a byte written without it has to be unwrapped and rewritten by hand
 * from a backup. The columns that will live here are named in the design and
 * arrive with the modules that own them: `students.medical_remarks` and the
 * `SafetyNote` free text (D-148, D-177), `AssessmentRemark` (D-148), the
 * settings-registry secrets (SMTP, OAuth) once `OrganizationSettingSecret`
 * exists, and `Inquiry` free text. Each one adds its entry here in the same
 * commit as its column.
 */
export const ENCRYPTED_COLUMNS = {
  "fixture.round_trip": {
    columnId: "fixture.round_trip",
    model: "__fixture__",
    field: "__fixture__",
    purpose: "fixture-v1",
    fixture: true,
    note:
      "Golden-vector and round-trip fixture (D-097). Belongs to no table; the " +
      "sync test asserts it names no real model, so the committed vectors " +
      "cannot drift into being a live column's binding.",
  },
} as const satisfies Record<string, EncryptedColumnEntry>;

/** Every registered column identifier, as a type. */
export type EncryptedColumnId = keyof typeof ENCRYPTED_COLUMNS;

/** The registry as an injectable shape, so tests can supply a variant. */
export type EncryptedColumnRegistry = Readonly<
  Record<string, EncryptedColumnEntry>
>;

/** A `columnId` that is not in the registry was passed to the envelope. */
export class UnknownEncryptedColumnError extends Error {
  constructor(columnId: string) {
    super(
      `"${columnId}" is not in the encrypted-column registry ` +
        "(src/lib/crypto/encrypted-columns.ts). A column id is permanent and " +
        "is bound into the AAD of every value written under it, so it is " +
        "registered deliberately and never invented at a call site.",
    );
    this.name = "UnknownEncryptedColumnError";
  }
}

/**
 * Resolves a `columnId` to its entry, or throws. Never returns a default:
 * guessing a purpose label would derive the wrong key and produce a value
 * nothing can read back.
 */
export function encryptedColumn(
  columnId: string,
  registry: EncryptedColumnRegistry = ENCRYPTED_COLUMNS,
): EncryptedColumnEntry {
  const entry = registry[columnId];
  if (!entry) throw new UnknownEncryptedColumnError(columnId);
  return entry;
}
