/**
 * Root middleware. Two independent concerns, both applied to every request it
 * sees (see `config.matcher` below):
 *
 * 1. Request-id propagation, for API routes: every incoming `/api/*` request is
 *    assigned a unique, opaque request id, available to route handlers via the
 *    `x-request-id` request header and returned to the caller in the
 *    `x-request-id` response header, for log correlation and for the
 *    `requestId` column on an audit event.
 *
 * 2. Baseline security headers on EVERY response: Content-Security-Policy,
 *    X-Content-Type-Options, X-Frame-Options, Referrer-Policy and
 *    (production only) Strict-Transport-Security.
 *
 * CSP strategy: the portal renders through the App Router, which injects its
 * own inline bootstrap/hydration `<script>` tags on every page. Rather than
 * weaken `script-src` with `'unsafe-inline'`, a random nonce is generated per
 * request and forwarded to Next.js through the documented mechanism — a
 * `Content-Security-Policy` REQUEST header carrying `'nonce-<value>'` in
 * `script-src`. Next detects that nonce and applies it to the inline scripts it
 * manages, so no application code threads it through by hand.
 *
 * `style-src` allows `'unsafe-inline'` because Bootstrap's interactive
 * components render inline `style` attributes for transitions and positioning,
 * and there is no practical way to nonce an element's `style` attribute.
 *
 * This file deliberately has NO dependency on the structured logger, which
 * relies on Node-only APIs: middleware runs in the Edge runtime, so it is kept
 * to Web-standard APIs only (`crypto.randomUUID`, `btoa`).
 *
 * NOT HERE YET, and named so it is not rediscovered by accident: a throttle in
 * front of the Better Auth route. `src/app/api/auth/[...all]/route.ts` mounts
 * Better Auth's full endpoint surface, so a direct POST to
 * `/api/auth/sign-in/email` bypasses any application-level throttle in front of
 * a sign-in form. See the lock comment in the audit repository — this is where
 * the fix goes.
 */

import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/api/request-id";

/** Builds the Content-Security-Policy header value for a request. */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Sets the baseline security headers on the outgoing response. */
function applySecurityHeaders(response: NextResponse, csp: string): void {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // HSTS only makes sense for real HTTPS production traffic. It is a no-op —
  // and actively unhelpful — over plain HTTP, which is a real deployment shape
  // here while an instance still runs on a LAN name (FM-15).
  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApiRequest = pathname.startsWith("/api/");

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const forwardedHeaders = new Headers(request.headers);
  // Forwarding the CSP (with its nonce) on the REQUEST headers is what lets
  // Next's own renderer detect and apply the nonce to the inline scripts it
  // injects — see the file comment.
  forwardedHeaders.set("Content-Security-Policy", csp);

  const requestId = isApiRequest
    ? resolveRequestId(request.headers)
    : undefined;
  if (requestId) forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  applySecurityHeaders(response, csp);
  if (requestId) response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // Everything except Next's own static output and the favicon. Security
  // headers belong on every document and every API response.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
