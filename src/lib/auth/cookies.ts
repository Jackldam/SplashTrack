/**
 * Shared Better Auth cookie-forwarding helper.
 *
 * Better Auth returns session/challenge state as `Set-Cookie` response
 * headers. Server-side callers that need to chain a second Better Auth call
 * as that same session (bootstrap's enable-2FA step, login's two-factor
 * verify step) must convert those into a `Cookie` REQUEST header. Shared here
 * because ./bootstrap and ./login both need it.
 */

/** Builds a forwardable `Cookie` request header from a response's Set-Cookie. */
export function forwardCookies(responseHeaders: Headers): Headers {
  const forwarded = new Headers();
  const pairs = responseHeaders
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean);
  if (pairs.length > 0) forwarded.set("cookie", pairs.join("; "));
  return forwarded;
}
