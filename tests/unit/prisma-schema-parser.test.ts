import { describe, expect, it } from "vitest";

import { extractModelBlocks } from "./prisma-schema-parser";

/**
 * Regression guard for the parser `person-reference-sync.test.ts` relies on to
 * find the true end of a Prisma `model { ... }` block.
 *
 * The bug this guards against: a naive `/model\s+(\w+)\s*\{([^}]*)\}/` regex
 * stops at the FIRST literal `}`. Real model doc comments in
 * prisma/schema.prisma contain a balanced `{...}` of their own (a JSON-shape
 * example in `AuditEvent`; the template's `PlatformSettings` had a hex-colour
 * regex "`^#[0-9a-fA-F]{6}$`" before phase 0.3 merged that model away), which
 * truncates the captured body right there — silently dropping every field
 * declared after it, and every downstream classification check that reads
 * that body. The template's org-scope sync test carried exactly this bug for a
 * time and got lucky: none of the truncated models' MISSING fields happened to
 * be the one it was scanning for. Without this test, a future "simplification" of
 * `extractModelBlocks` back to a naive regex would reintroduce that bug
 * silently — the sync tests would keep passing on today's schema and only
 * fail once some future model's real gap fell after a balanced-brace comment.
 */
describe("extractModelBlocks", () => {
  const FIXTURE = `
model Foo {
  id String @id

  /// Example format: \`^#[0-9a-fA-F]{6}$\` (a balanced brace pair IN A COMMENT.
  /// The FIXTURE is deliberately independent of the real schema, so it keeps
  /// guarding the parser after the model that first exhibited this shape is
  /// gone).
  hexColor String

  /// A field declared AFTER the in-comment balanced braces above. A naive
  /// first-closing-brace regex truncates the body before reaching this line.
  afterCommentField String

  lastFieldInTheBlock String
}

model Bar {
  id String @id
}
`;

  it("parses a model body completely past a doc comment containing a balanced brace pair", () => {
    const blocks = extractModelBlocks(FIXTURE);
    const fooBody = blocks.get("Foo");
    expect(fooBody).toBeDefined();
    expect(fooBody).toContain("afterCommentField");
    expect(fooBody).toContain("lastFieldInTheBlock");
  });

  it("still finds the NEXT model after one whose body contains a balanced-brace comment", () => {
    // A parser that mis-tracks depth wouldn't just truncate Foo — it could
    // also misplace where Foo's block ENDS, corrupting where Bar's scan
    // starts. Both blocks must come out right.
    const blocks = extractModelBlocks(FIXTURE);
    expect(blocks.has("Bar")).toBe(true);
    expect(blocks.get("Bar")).toContain("id String @id");
  });

  it("demonstrates the bug: a naive first-`}` regex truncates the same fixture", () => {
    // This is not the parser under test — it is a local reproduction of the
    // OLD, buggy pattern this file's suite protects against reverting to,
    // kept here so the contrast is verified by a real assertion rather than
    // narrated in a comment.
    const naiveBlocks = new Map<string, string>();
    const modelBlockPattern = /model\s+(\w+)\s*\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = modelBlockPattern.exec(FIXTURE)) !== null) {
      naiveBlocks.set(match[1], match[2]);
    }

    const naiveFooBody = naiveBlocks.get("Foo");
    expect(naiveFooBody).toBeDefined();
    // The naive parser truncates at the `{6}` in the comment and never sees
    // the rest of the model.
    expect(naiveFooBody).not.toContain("afterCommentField");
    expect(naiveFooBody).not.toContain("lastFieldInTheBlock");

    // The fixed parser, by contrast, sees both.
    const fixedFooBody = extractModelBlocks(FIXTURE).get("Foo");
    expect(fixedFooBody).toContain("afterCommentField");
    expect(fixedFooBody).toContain("lastFieldInTheBlock");
  });
});
