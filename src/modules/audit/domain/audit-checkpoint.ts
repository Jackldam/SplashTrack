/**
 * Audit checkpoint domain (D-168). Pure types and the MAC primitives; no I/O.
 *
 * A checkpoint is the signed anchor a retention run leaves behind so the chain
 * still verifies across the gap that run made. Without it the FIRST legitimate
 * retention run breaks `audit:verify` permanently — a tamper detector with a
 * 100% false-positive rate from month twelve, which is worse than none (F-137).
 *
 * WHAT THE ANCHOR IS. `sequence` and `chainHash` are the LAST PRUNED row and
 * its hash — exactly the value the first surviving row carries in
 * `previousHash`. Verification resumes with `previousHash := chainHash` and
 * walks forward, which is byte-for-byte the shape genesis has: `AUDIT_GENESIS_HASH`
 * is also a `previousHash`, never a row's own hash. D-168 rule 5 asks for
 * exactly one shape — "genesis is treated as checkpoint zero" — and this is it,
 * which is also why the first checkpoint's `previousCheckpointHash` IS the
 * genesis constant rather than a second invented one.
 *
 * (D-168's record sketch calls `sequence` the "last SURVIVING" sequence. Read
 * literally that cannot work — a prefix prune deletes the anchor row of every
 * earlier segment — so the rule wins over the sketch. See
 * `docs/build/phase-0.4a-crypto-and-audit-report.md`.)
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { deriveKey } from "@/lib/crypto";

/**
 * The MAC canonicalization version every NEW checkpoint is written at. Bump it
 * (and add a branch in {@link canonicalizeCheckpoint}) whenever a field joins
 * the signed content; existing checkpoints keep their own `macVersion` and
 * verify against the branch they were written with. Same mechanism, same
 * reason, as `AuditEvent.contentVersion`.
 */
export const CURRENT_CHECKPOINT_MAC_VERSION = 1;

/** The HKDF purpose the checkpoint key derives under (D-168, verbatim). */
export const AUDIT_ANCHOR_PURPOSE = "audit-anchor-v1" as const;

/** The signed content of one checkpoint. */
export interface AuditCheckpointContent {
  macVersion: number;
  /** Last PRUNED sequence — the anchor. See the file header. */
  sequence: number;
  /** That row's hash: what the first surviving row must show as previousHash. */
  chainHash: string;
  prunedFromSequence: number;
  prunedToSequence: number;
  prunedCount: number;
  prunedFrom: Date;
  prunedTo: Date;
  /** The previous checkpoint's `mac`, or the genesis constant for the first. */
  previousCheckpointHash: string;
  createdAt: Date;
}

/** A checkpoint as stored, content plus its MAC. */
export interface StoredAuditCheckpoint extends AuditCheckpointContent {
  id: string;
  mac: string;
}

/**
 * Canonical, stable serialization of a checkpoint's signed content. A
 * FIXED-ORDER array, like `canonicalizeAuditContent`, so the same checkpoint
 * always digests identically and a read-back reproduces the input byte for
 * byte.
 *
 * **v1 IS FROZEN.** Every checkpoint ever written commits to exactly this order
 * and membership. A field may be APPENDED under a new version; nothing may be
 * reordered or removed.
 */
export function canonicalizeCheckpoint(
  content: AuditCheckpointContent,
): string {
  const v1Fields = [
    content.sequence,
    content.chainHash,
    content.prunedFromSequence,
    content.prunedToSequence,
    content.prunedCount,
    content.prunedFrom.toISOString(),
    content.prunedTo.toISOString(),
    content.previousCheckpointHash,
    content.createdAt.toISOString(),
  ];
  return JSON.stringify(v1Fields);
}

/**
 * HMAC-SHA256 of a checkpoint's canonical content under
 * `HKDF(SECRET_KEY, info="audit-anchor-v1")`. Hex.
 *
 * `key` is injectable for tests and for a future `key:rotate`; the default is
 * this instance's own derivation.
 */
export function computeCheckpointMac(
  content: AuditCheckpointContent,
  key: Buffer = deriveKey(AUDIT_ANCHOR_PURPOSE),
): string {
  return createHmac("sha256", key)
    .update(canonicalizeCheckpoint(content))
    .digest("hex");
}

/**
 * Constant-time verification of a stored checkpoint's MAC.
 *
 * Constant time is not theatre here: the MAC is what stops an attacker with
 * database write access from deleting interior rows and forging a covering
 * checkpoint, and `audit:verify` is a path such an attacker can run repeatedly.
 */
export function verifyCheckpointMac(
  checkpoint: StoredAuditCheckpoint,
  key?: Buffer,
): boolean {
  const expected = Buffer.from(computeCheckpointMac(checkpoint, key), "utf8");
  const actual = Buffer.from(checkpoint.mac, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
