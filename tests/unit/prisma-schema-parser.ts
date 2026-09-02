/**
 * Shared parser for `prisma/schema.prisma`, used by every schema-vs-map sync
 * test (`organization-scope-sync.test.ts`, `person-reference-sync.test.ts`,
 * and any future one). Factored out so there is exactly ONE implementation to
 * get right — two independent copies of a subtle parser drift apart, which
 * defeats the point of a drift-detection test.
 *
 * Extracts every top-level `model Name { ... }` block's NAME and BODY.
 *
 * Deliberately NOT the naive `/model\s+(\w+)\s*\{([^}]*)\}/` pattern: that
 * stops at the FIRST literal `}`, and several model doc comments in this
 * schema contain a balanced `{...}` of their own (e.g. the hex-colour regex
 * example "`^#[0-9a-fA-F]{6}$`" in `PlatformSettings`, or a JSON-shape example
 * in `AuditEvent` / `CustomPage` / `EmailTemplate` / `ProfileFieldConsentText`)
 * — which truncates the body right there, before the model's REAL closing
 * brace, and silently drops every field declared after it.
 *
 * A brace-DEPTH walk (matching `{`/`}` pairs, which a balanced in-comment
 * `{6}` does not upset) finds the true end of each block. See
 * `prisma-schema-parser.test.ts` for the regression guard.
 */
export function extractModelBlocks(schema: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const startPattern = /model\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(schema)) !== null) {
    const name = match[1];
    let depth = 1;
    let i = match.index + match[0].length;
    const bodyStart = i;
    while (depth > 0 && i < schema.length) {
      const ch = schema[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    blocks.set(name, schema.slice(bodyStart, i - 1));
  }
  return blocks;
}
