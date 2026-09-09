import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_FORMAT,
  CURRENT_KEY_ID,
  DECRYPTORS,
  DecryptionRefusedError,
  FORMAT_VERSIONS,
  UnknownEncryptedColumnError,
  UnknownKeyIdError,
  createKeyring,
  encryptedColumnAad,
  isSealedEnvelope,
  keyIdOf,
  open,
  seal,
  type EncryptedColumnRegistry,
} from "@/lib/crypto";

/**
 * The D-096/D-167 envelope.
 *
 * Four of these tests are the ones the phase's definition of done names, and
 * each stands for a specific way this product fails without them:
 *
 *   - a value round-trips                     — the envelope works at all;
 *   - the wrong key REFUSES rather than
 *     returning garbage or null              — D-166, the restore that
 *                                              reported success on an instance
 *                                              where nothing was readable;
 *   - AAD binding survives a table rename    — D-167/F-136, a rename that reads
 *                                              as tampering, unattended, after
 *                                              the pre-migration backup;
 *   - a ciphertext is not portable between
 *     rows                                   — D-096, child A's allergy note
 *                                              decrypting perfectly in child
 *                                              B's row.
 *
 * All key material here is a fixed PUBLIC test value. Nothing in this file
 * reads the instance's own `SECRET_KEY`.
 */

const TEST_SECRET = Buffer.alloc(32, 0x2b);
const OTHER_SECRET = Buffer.alloc(32, 0x5c);

const keyring = createKeyring(TEST_SECRET);
const wrongKeyring = createKeyring(OTHER_SECRET);

const COLUMN = "fixture.round_trip";
const ROW = "cm4qz9x1k0000abcd1234efgh";

describe("envelope round trip", () => {
  it("returns the exact plaintext it was given", () => {
    const sealed = seal(COLUMN, ROW, "absence seizures — get her out", {
      keyring,
    });
    expect(open(COLUMN, ROW, sealed, { keyring })).toBe(
      "absence seizures — get her out",
    );
  });

  it("writes the specified format: v1:<keyId>:<nonce>:<ct>", () => {
    const sealed = seal(COLUMN, ROW, "value", { keyring });
    const parts = sealed.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(CURRENT_FORMAT);
    expect(parts[1]).toBe(CURRENT_KEY_ID);
    expect(isSealedEnvelope(sealed)).toBe(true);
    // The key generation is readable WITHOUT the key — that is what makes an
    // interrupted rotation a query rather than a guess (D-096).
    expect(keyIdOf(COLUMN, sealed)).toBe(CURRENT_KEY_ID);
  });

  it("never emits the plaintext", () => {
    const sealed = seal(COLUMN, ROW, "pindakaas-allergie", { keyring });
    expect(sealed).not.toContain("pindakaas");
  });

  it("produces a different envelope every time (random nonce)", () => {
    const a = seal(COLUMN, ROW, "same", { keyring });
    const b = seal(COLUMN, ROW, "same", { keyring });
    expect(a).not.toBe(b);
    expect(open(COLUMN, ROW, a, { keyring })).toBe(
      open(COLUMN, ROW, b, { keyring }),
    );
  });

  it("round-trips empty strings and multi-byte text", () => {
    for (const value of ["", "ë✓🏊 — 25 m schoolslag", "x".repeat(4096)]) {
      const sealed = seal(COLUMN, ROW, value, { keyring });
      expect(open(COLUMN, ROW, sealed, { keyring })).toBe(value);
    }
  });
});

describe("refusal (D-166: never a quiet success)", () => {
  it("REFUSES the wrong key rather than returning garbage or null", () => {
    const sealed = seal(COLUMN, ROW, "medical note", { keyring });
    // The failure must be an exception. A helper that returned null here is
    // how a restore reports success while every protected value is dead.
    expect(() => open(COLUMN, ROW, sealed, { keyring: wrongKeyring })).toThrow(
      DecryptionRefusedError,
    );
  });

  it("refuses a ciphertext moved to another row (the AAD's whole point)", () => {
    // Child A's note, copied into child B's row by a SQL write primitive or a
    // careless de-duplication script.
    const childA = seal(COLUMN, "person_a", "severe nut allergy", { keyring });
    expect(() => open(COLUMN, "person_b", childA, { keyring })).toThrow(
      DecryptionRefusedError,
    );
  });

  it("refuses a ciphertext read against a different registered column", () => {
    const registry: EncryptedColumnRegistry = {
      "fixture.round_trip": {
        columnId: "fixture.round_trip",
        model: "__fixture__",
        field: "__fixture__",
        purpose: "fixture-v1",
        fixture: true,
        note: "test",
      },
      "fixture.other_column": {
        columnId: "fixture.other_column",
        model: "__fixture__",
        field: "__fixture__",
        purpose: "fixture-v1",
        fixture: true,
        note: "test",
      },
    };
    const sealed = seal(COLUMN, ROW, "value", { keyring, registry });
    expect(() =>
      open("fixture.other_column", ROW, sealed, { keyring, registry }),
    ).toThrow(DecryptionRefusedError);
  });

  it("refuses a modified ciphertext", () => {
    const sealed = seal(COLUMN, ROW, "original", { keyring });
    const parts = sealed.split(":");
    const bytes = Buffer.from(parts[3], "base64url");
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString("base64url");
    expect(() => open(COLUMN, ROW, parts.join(":"), { keyring })).toThrow(
      DecryptionRefusedError,
    );
  });

  it("refuses a key id this instance does not hold", () => {
    const sealed = seal(COLUMN, ROW, "value", {
      keyring: createKeyring(TEST_SECRET, "2"),
    });
    // An interrupted rotation, or a value from another instance. Falling back
    // to the current key would turn a stateable condition into "corruption".
    expect(() => open(COLUMN, ROW, sealed, { keyring })).toThrow(
      UnknownKeyIdError,
    );
  });

  it("refuses a plaintext that reached a protected column another way", () => {
    expect(() => open(COLUMN, ROW, "just a note", { keyring })).toThrow(
      /not an envelope/,
    );
  });

  it("refuses a format with no decryptor, and says it is a version problem", () => {
    const sealed = seal(COLUMN, ROW, "value", { keyring });
    const future = `v9${sealed.slice(2)}`;
    expect(() => open(COLUMN, ROW, future, { keyring })).toThrow(
      /no decryptor/,
    );
  });

  it("refuses an unregistered column id at the call site", () => {
    expect(() => seal("invented.on.the.spot", ROW, "x", { keyring })).toThrow(
      UnknownEncryptedColumnError,
    );
  });

  it("refuses an empty primary key", () => {
    expect(() => seal(COLUMN, "", "x", { keyring })).toThrow(/primary key/);
  });
});

describe("AAD binding survives a rename (D-167, F-136)", () => {
  /**
   * The scenario the decision exists for: `StudentProfile.medicalRemarks` is
   * renamed by a migration that runs unattended at container start, AFTER the
   * pre-migration backup. If the AAD bound the physical name, every value in
   * the column would fail authentication — indistinguishably from tampering —
   * and neither the backup nor the running instance could read it.
   */
  const before: EncryptedColumnRegistry = {
    "students.medical_remarks": {
      columnId: "students.medical_remarks",
      model: "StudentProfile",
      field: "medicalRemarks",
      purpose: "fixture-v1",
      fixture: true,
      note: "test",
    },
  };
  const afterRename: EncryptedColumnRegistry = {
    "students.medical_remarks": {
      // The permanent identifier is untouched...
      columnId: "students.medical_remarks",
      // ...while the physical model and field, which D-159 and D-100 schedule
      // to change, both move.
      model: "PupilRecord",
      field: "healthNotes",
      purpose: "fixture-v1",
      fixture: true,
      note: "test",
    },
  };

  it("decrypts a value written before the rename", () => {
    const sealed = seal("students.medical_remarks", ROW, "epilepsie", {
      keyring,
      registry: before,
    });
    expect(
      open("students.medical_remarks", ROW, sealed, {
        keyring,
        registry: afterRename,
      }),
    ).toBe("epilepsie");
  });

  it("computes an AAD that does not mention the model or the field", () => {
    // Asserted directly, not only through the round trip above: the round trip
    // would also pass if the AAD happened to be constant.
    const aad = encryptedColumnAad("students.medical_remarks", ROW, "1");
    expect(aad.toString("utf8")).toBe(
      JSON.stringify(["students.medical_remarks", ROW, "1"]),
    );
    expect(aad.toString("utf8")).not.toContain("StudentProfile");
    expect(aad.toString("utf8")).not.toContain("medicalRemarks");
  });

  it("still refuses when the columnId itself changes", () => {
    // The corollary. A rename is free; reusing or changing a columnId is not,
    // and must fail rather than quietly rebind a ciphertext.
    const sealed = seal("students.medical_remarks", ROW, "epilepsie", {
      keyring,
      registry: before,
    });
    const renamedId: EncryptedColumnRegistry = {
      "students.health_notes": {
        columnId: "students.health_notes",
        model: "PupilRecord",
        field: "healthNotes",
        purpose: "fixture-v1",
        fixture: true,
        note: "test",
      },
    };
    expect(() =>
      open("students.health_notes", ROW, sealed, {
        keyring,
        registry: renamedId,
      }),
    ).toThrow(DecryptionRefusedError);
  });
});

describe("the decryptor registry (D-097)", () => {
  const vectors = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests", "fixtures", "crypto-golden-vectors.json"),
      "utf8",
    ),
  ) as {
    secretBase64: string;
    vectors: {
      format: string;
      columnId: string;
      primaryKey: string;
      keyId: string;
      ciphertext: string;
      expectedPlaintext: string;
    }[];
  };

  it("retains a decryptor for every format ever shipped", () => {
    for (const format of FORMAT_VERSIONS) {
      expect(DECRYPTORS[format], format).toBeTypeOf("function");
    }
  });

  it("decrypts every committed golden vector", () => {
    // THIS IS THE ENFORCEMENT D-049 NEVER HAD. A backup contains ciphertext; if
    // the scheme changes, a new version must still read the old format or the
    // restore "succeeds" with quietly unreadable contents, which no schema test
    // catches. Removing or breaking a decryptor breaks the build here.
    const vectorKeyring = createKeyring(
      Buffer.from(vectors.secretBase64, "base64"),
    );
    expect(vectors.vectors.length).toBeGreaterThanOrEqual(
      FORMAT_VERSIONS.length,
    );
    for (const vector of vectors.vectors) {
      expect(
        open(vector.columnId, vector.primaryKey, vector.ciphertext, {
          keyring: createKeyring(
            Buffer.from(vectors.secretBase64, "base64"),
            vector.keyId,
          ),
        }),
        `${vector.format} / ${vector.columnId}`,
      ).toBe(vector.expectedPlaintext);
    }
    expect(vectorKeyring.currentKeyId).toBe(CURRENT_KEY_ID);
  });

  it("covers every format in the golden-vector file", () => {
    const covered = new Set(vectors.vectors.map((vector) => vector.format));
    for (const format of FORMAT_VERSIONS) {
      expect(covered.has(format), `no golden vector for ${format}`).toBe(true);
    }
  });
});
