/**
 * Best-effort client IP for a per-IP rate-limit bucket, shared by every
 * request-context caller (registration, login, sensitive profile actions).
 *
 * SECURITY: the LEFTMOST `X-Forwarded-For` entry is client-supplied and
 * trivially spoofed (an attacker rotates it to land in a fresh bucket every
 * request), so we do NOT trust it. Prefer `x-real-ip` (a single value a trusted
 * proxy sets to the real client), else the RIGHTMOST `X-Forwarded-For` entry —
 * the hop the nearest trusted proxy appended, which an attacker cannot remove.
 * Correct behind a single trusted reverse proxy (the UAT/typical deployment); a
 * different proxy topology (or none) should ensure its edge sets a trusted
 * client-IP header. A per-EMAIL/per-account limit is the topology-independent
 * backstop regardless.
 *
 * SERVER-ONLY (reads request headers).
 */

import { headers } from "next/headers";

/**
 * Pure extraction of the same "trust `x-real-ip`, else the rightmost
 * `x-forwarded-for` hop" logic, taking a `Headers` object directly rather than
 * reading Next's AMBIENT request store. Split out so a caller that already
 * HAS a `Headers` object but is NOT running inside a Next.js request scope —
 * e.g. a Better Auth hook invoked from a plain `auth.api.*` call in a test —
 * can reuse the exact same rule without going through `next/headers` (which
 * throws outside a request scope).
 */
export function resolveClientIp(h: Headers): string {
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "unknown";
}

export async function getClientIp(): Promise<string> {
  return resolveClientIp(await headers());
}
