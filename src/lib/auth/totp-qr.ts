/**
 * An `otpauth://` URI, as something a phone camera can read and a person can
 * type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE QR IS A PATH AND NOT AN IMAGE, AND NOT `dangerouslySetInnerHTML`
 *
 * `uqr` will render a complete SVG document as a string, and dropping that into
 * the page would take one line. It would also mean an `<svg>` this application
 * did not itself construct being injected as raw HTML on the one page a
 * half-enrolled administrator is forced to visit. Nothing about the current
 * generator makes that unsafe, but "the library we chose does not emit anything
 * dangerous today" is not a property this file can keep true.
 *
 * So only the MATRIX is taken from the library, and the geometry is built here
 * into a single SVG path `d` — a string of digits, `M`, `h`, `v`, `z` and
 * nothing else, rendered by React as an ordinary attribute. There is no HTML
 * injection point at all, and the `otpauth://` URI (which contains the secret)
 * never appears in the markup.
 *
 * A `data:` image was the other option and is worse on both counts: it would
 * base64-inflate ~12 KB of markup, and it needs `img-src data:` in the CSP to
 * be relied on rather than merely tolerated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE MANUAL KEY IS FOR
 *
 * Not every authenticator can scan — a desktop password manager, a phone whose
 * camera is refused, a person who would rather type. `otpauth://`'s `secret`
 * parameter IS the key, base32-encoded, which is exactly what such an app asks
 * for. It is grouped in fours because a 32-character run of base32 is
 * transcribed wrongly by people, not because it looks tidier.
 *
 * THE SECRET IS STILL NOT ALLOWED IN A LOG. D-185 moved enrolment to the
 * browser precisely so it never reaches a terminal, a scrollback buffer or a
 * pasted issue — a page rendered once into one session is not any of those.
 * Nothing in this file logs, and nothing that calls it may log its return value.
 */

import { encode } from "uqr";

/** One rendered enrolment artefact. Everything the page needs, and no more. */
export interface TotpEnrolmentArtefact {
  /** SVG path data for the QR modules. Digits and path commands only. */
  qrPath: string;
  /** Side length of the square `viewBox` the path is drawn in. */
  qrSize: number;
  /** The base32 key, in groups of four, for an authenticator that cannot scan. */
  manualKey: string;
}

/** Quiet zone, in modules. Four is the QR specification's minimum. */
const QUIET_ZONE = 4;

export function renderTotpEnrolment(totpURI: string): TotpEnrolmentArtefact {
  return {
    ...renderQrPath(totpURI),
    manualKey: groupInFours(manualKeyOf(totpURI)),
  };
}

/** The `secret` parameter — the base32 key an authenticator asks to be typed. */
function manualKeyOf(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) {
    throw new Error("The enrolment URI carries no `secret` parameter.");
  }
  return secret;
}

function groupInFours(value: string): string {
  return (value.match(/.{1,4}/g) ?? [value]).join(" ");
}

/**
 * The QR matrix as one SVG path, one `M…h…v…h…z` sub-path per dark module.
 *
 * Per-module rather than run-length-merged: a merged path is smaller and is
 * also a second encoding of the same data that can be subtly wrong in a way
 * that still renders. This one is trivially correct, and the page it serves is
 * visited once per account.
 */
function renderQrPath(text: string): { qrPath: string; qrSize: number } {
  const qr = encode(text, { border: QUIET_ZONE });
  const parts: string[] = [];

  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.data[y][x]) parts.push(`M${x},${y}h1v1h-1z`);
    }
  }

  return { qrPath: parts.join(""), qrSize: qr.size };
}
