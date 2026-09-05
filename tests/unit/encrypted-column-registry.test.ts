import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ENCRYPTED_COLUMNS, ENCRYPTED_COLUMN_ENTRIES } from "@/lib/crypto";
import { KEY_PURPOSES } from "@/lib/crypto/secret-key";

import { extractModelBlocks } from "./prisma-schema-parser";

/**
 * The encrypted-column registry stays in sync with `prisma/schema.prisma`
 * (D-167), checked BIDIRECTIONALLY in the shape D-135 already adopts for
 * `person-reference-sync.test.ts`.
 *
 * D-167 requires this test by name: *"the registry is bidirectionally
 * test-enforced — every registry entry resolves to a real model and field, and
 * every field the schema marks as encrypted has an entry. A rename that forgets
 * to update the mapping fails the build rather than the decryption."*
 *
 * THE MARKER. The design names the test but not how the schema marks a column,
 * so the convention is fixed here: a `/// @encrypted <columnId>` doc-comment
 * line on the field.
 *
 *     /// @encrypted students.medical_remarks
 *     medicalRemarks String?
 *
 * A doc comment rather than an attribute because Prisma has no user-defined
 * field attributes, and `///` survives `prisma format` and travels into the
 * generated client's documentation where a reader of the model sees it.
 *
 * THE REGISTRY IS EMPTY OF PRODUCTION COLUMNS TODAY, AND THIS TEST IS STILL THE
 * POINT: it is what makes the first real encrypted column arrive with its entry
 * instead of six months later, when the ciphertext already exists.
 */

const MARKER = /^\s*\/\/\/\s*@encrypted\s+(\S+)\s*$/;

/** Every `/// @encrypted <id>` marker in the schema, with its model and field. */
function schemaMarkers(): Map<string, { model: string; field: string }> {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf-8",
  );
  const found = new Map<string, { model: string; field: string }>();

  for (const [model, body] of extractModelBlocks(schema)) {
    const lines = body.split("\n");
    lines.forEach((line, index) => {
      const marker = MARKER.exec(line);
      if (!marker) return;
      // The marked field is the next line that declares one. Doc comments stack,
      // so skip any further comment lines between the marker and the field.
      const fieldLine = lines
        .slice(index + 1)
        .find((candidate) => /^\s*\w+\s+\S/.test(candidate));
      const field = fieldLine ? /^\s*(\w+)/.exec(fieldLine)?.[1] : undefined;
      expect(
        field,
        `@encrypted marker in model ${model} is not followed by a field`,
      ).toBeDefined();
      found.set(marker[1], { model, field: field as string });
    });
  }
  return found;
}

describe("encrypted-column registry (D-167)", () => {
  const markers = schemaMarkers();
  const entries = ENCRYPTED_COLUMN_ENTRIES;

  it("keys every entry by its own columnId", () => {
    // The key and the field must agree, or `encryptedColumn()` would resolve a
    // lookup to an entry that binds a DIFFERENT id into the AAD.
    for (const [key, entry] of Object.entries(ENCRYPTED_COLUMNS)) {
      expect(entry.columnId, key).toBe(key);
    }
  });

  it("uses a known HKDF purpose for every entry", () => {
    for (const entry of entries) {
      expect(
        (KEY_PURPOSES as readonly string[]).includes(entry.purpose),
        `${entry.columnId} derives under an unknown purpose "${entry.purpose}"`,
      ).toBe(true);
    }
  });

  it("gives every entry a written reason", () => {
    for (const entry of entries) {
      expect(entry.note.trim().length, entry.columnId).toBeGreaterThan(0);
    }
  });

  it("uses the permanent columnId vocabulary shape", () => {
    // `<area>.<name>`, lower snake case. A typo here is a name we live with
    // forever (D-167's stated trade-off), so the shape is at least mechanical.
    for (const entry of entries) {
      expect(entry.columnId, entry.columnId).toMatch(
        /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
      );
    }
  });

  it("resolves every non-fixture entry to a marked schema field", () => {
    const unresolved = entries
      .filter((entry) => !entry.fixture)
      .filter((entry) => {
        const marker = markers.get(entry.columnId);
        return (
          !marker ||
          marker.model !== entry.model ||
          marker.field !== entry.field
        );
      })
      .map((entry) => `${entry.columnId} (${entry.model}.${entry.field})`);

    expect(
      unresolved,
      `${unresolved.join(", ")} is/are registered as encrypted columns but do ` +
        "not match a `/// @encrypted <columnId>` marker on that model and " +
        "field in prisma/schema.prisma. After a RENAME, update the entry's " +
        "model/field — never its columnId, which is bound into the AAD of " +
        "every value already written (D-167).",
    ).toEqual([]);
  });

  it("has an entry for every @encrypted marker in the schema", () => {
    const unregistered = [...markers.entries()]
      .filter(([columnId]) => !(columnId in ENCRYPTED_COLUMNS))
      .map(([columnId, at]) => `${columnId} (${at.model}.${at.field})`);

    expect(
      unregistered,
      `${unregistered.join(", ")} is/are marked @encrypted in ` +
        "prisma/schema.prisma with no entry in ENCRYPTED_COLUMNS " +
        "(src/lib/crypto/encrypted-columns.ts). Without an entry the envelope " +
        "cannot resolve a key purpose, so the column would be written in " +
        "plaintext or not at all.",
    ).toEqual([]);
  });

  it("keeps fixture entries out of the schema", () => {
    // A fixture columnId is bound into the COMMITTED golden vectors. If one
    // ever became a live column's binding, rotating or retiring the fixture
    // would silently be a change to a real column's AAD.
    const leaked = entries
      .filter((entry) => entry.fixture)
      .filter((entry) => markers.has(entry.columnId))
      .map((entry) => entry.columnId);
    expect(
      leaked,
      `${leaked.join(", ")} is/are marked as fixture-only but appear as an ` +
        "@encrypted marker in the schema.",
    ).toEqual([]);
  });
});
