import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DERIVED_KEY_BYTES,
  KEY_PURPOSES,
  MissingBootstrapSecretError,
  deriveKey,
  describeSecretKeySource,
  loadBootstrapSecret,
  resetBootstrapSecretCache,
} from "@/lib/crypto/secret-key";

/**
 * The bootstrap secret and the HKDF split (D-112).
 *
 * Everything here is about REFUSAL as much as derivation. D-166's rule is that
 * anything which cannot decrypt fails loudly and never succeeds quietly, and
 * the cheapest way to break it is upstream of the envelope: a loader that
 * quietly derives from an empty string, a truncated file or a missing one. Each
 * of those is asserted to throw.
 */

const FIXED_SECRET = Buffer.alloc(32, 7);

function writeSecretFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "splashtrack-secret-"));
  const path = join(dir, "secret_key");
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  resetBootstrapSecretCache();
});

describe("deriveKey (HKDF over the bootstrap secret)", () => {
  it("derives a 256-bit key, deterministically", () => {
    const a = deriveKey("medical-v1", FIXED_SECRET);
    const b = deriveKey("medical-v1", FIXED_SECRET);
    expect(a).toHaveLength(DERIVED_KEY_BYTES);
    expect(a.equals(b)).toBe(true);
  });

  it("gives every purpose its own key", () => {
    // The whole point of the purpose label: compromise or rotation of one
    // branch must not be the same key material as another. If two labels ever
    // collide, an audit checkpoint MAC and a medical column share a key.
    const derived = KEY_PURPOSES.map((purpose) =>
      deriveKey(purpose, FIXED_SECRET).toString("hex"),
    );
    expect(new Set(derived).size).toBe(KEY_PURPOSES.length);
  });

  it("derives different keys from different secrets", () => {
    const other = Buffer.alloc(32, 9);
    expect(
      deriveKey("medical-v1", FIXED_SECRET).equals(
        deriveKey("medical-v1", other),
      ),
    ).toBe(false);
  });

  it("is stable across releases (frozen vector)", () => {
    // A committed vector, not a self-consistency check: if a future change to
    // the salt, the digest or the info encoding silently altered the
    // derivation, every previously encrypted value would become unreadable and
    // nothing else in the suite would notice.
    expect(deriveKey("medical-v1", FIXED_SECRET).toString("hex")).toBe(
      "52f01027f861bbc2c6b750648651da65f715347413f83d5bfde2e7a4e9be407f",
    );
  });
});

describe("loadBootstrapSecret", () => {
  it("reads SECRET_KEY_FILE and reports the file as its source", () => {
    const path = writeSecretFile(FIXED_SECRET.toString("base64"));
    const secret = loadBootstrapSecret({ SECRET_KEY_FILE: path });
    expect(secret.equals(FIXED_SECRET)).toBe(true);
    expect(describeSecretKeySource()).toEqual({
      kind: "file",
      path,
      deprecated: false,
    });
  });

  it("tolerates a trailing newline in the file", () => {
    const path = writeSecretFile(`${FIXED_SECRET.toString("base64")}\n`);
    expect(
      loadBootstrapSecret({ SECRET_KEY_FILE: path }).equals(FIXED_SECRET),
    ).toBe(true);
  });

  it("accepts the plain SECRET_KEY variable but marks it deprecated", () => {
    const secret = loadBootstrapSecret({
      SECRET_KEY: FIXED_SECRET.toString("base64"),
    });
    expect(secret.equals(FIXED_SECRET)).toBe(true);
    expect(describeSecretKeySource()?.deprecated).toBe(true);
  });

  it("prefers the file over the deprecated variable", () => {
    const path = writeSecretFile(FIXED_SECRET.toString("base64"));
    const secret = loadBootstrapSecret({
      SECRET_KEY_FILE: path,
      SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
    });
    expect(secret.equals(FIXED_SECRET)).toBe(true);
  });

  it("refuses when neither variable is set", () => {
    expect(() => loadBootstrapSecret({})).toThrow(MissingBootstrapSecretError);
  });

  it("refuses a SECRET_KEY_FILE that does not exist", () => {
    expect(() =>
      loadBootstrapSecret({ SECRET_KEY_FILE: "/nonexistent/secret_key" }),
    ).toThrow(MissingBootstrapSecretError);
  });

  it("refuses an empty file", () => {
    const path = writeSecretFile("   \n");
    expect(() => loadBootstrapSecret({ SECRET_KEY_FILE: path })).toThrow(
      MissingBootstrapSecretError,
    );
  });

  it("refuses key material shorter than 32 bytes", () => {
    // "hunter2" as a bootstrap secret must be a boot failure, not a weak root
    // key that works well enough to encrypt a child's medical note with.
    const path = writeSecretFile("hunter2");
    expect(() => loadBootstrapSecret({ SECRET_KEY_FILE: path })).toThrow(
      /at least 32/,
    );
  });

  it("accepts a long non-base64 passphrase as raw key material", () => {
    const passphrase = "correct-horse-battery-staple-correct-horse-battery";
    const path = writeSecretFile(passphrase);
    expect(
      loadBootstrapSecret({ SECRET_KEY_FILE: path }).equals(
        Buffer.from(passphrase, "utf8"),
      ),
    ).toBe(true);
  });
});
