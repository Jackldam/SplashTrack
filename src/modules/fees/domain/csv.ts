/**
 * CSV formatting — RFC 4126-ish, minimal and deterministic. Pure.
 *
 * Deterministic in the sense the CSV export's requirement asks for: the same
 * rows always produce the same bytes — a fixed column order, `\r\n` line
 * endings throughout (RFC 4180), one escaping rule, no locale-dependent
 * number or date formatting anywhere in this module.
 */

/**
 * Escapes one field. Quoted, with embedded quotes doubled, whenever the value
 * contains the delimiter, a quote, or a line break — the RFC 4180 rule. Every
 * other value is emitted bare, so a plain fee-type code is not needlessly
 * quoted.
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Joins already-stringified cells into one CSV document, header included. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [header, ...rows].map((row) =>
    row.map(escapeCsvField).join(","),
  );
  return lines.join("\r\n") + "\r\n";
}
