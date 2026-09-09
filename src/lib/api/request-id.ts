/**
 * Request identifier utilities.
 *
 * Every incoming request receives a unique identifier that is:
 *   - returned in the API response,
 *   - included in logs,
 *   - included in audit records where relevant,
 *   - usable for troubleshooting.
 *
 * The identifier itself must never leak sensitive internal trace
 * information (e.g. stack traces, internal hostnames) - it is an opaque
 * correlation token only.
 */

/** Name of the header used to propagate the request id end-to-end. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Prefix used for generated request identifiers, e.g. "req_<uuid>". */
const REQUEST_ID_PREFIX = "req_";

/**
 * Generates a new opaque request identifier.
 *
 * The identifier is a random UUID and carries no information about the
 * caller, the server, or the request contents.
 *
 * Uses the Web Crypto API (`crypto.randomUUID()`, available globally in
 * both the Node.js and Edge runtimes) rather than importing Node's
 * `crypto` module, which is unsupported in Next.js Edge Middleware/Edge
 * Route Handlers.
 */
export function generateRequestId(): string {
  return `${REQUEST_ID_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Very loose validation for a client- or upstream-supplied request id, so
 * that we can safely reuse an incoming correlation id (e.g. from a proxy)
 * instead of always minting a new one, without accepting arbitrary
 * attacker-controlled strings into logs unchecked.
 */
function isValidRequestId(value: string | null | undefined): value is string {
  if (!value) return false;
  if (value.length < 1 || value.length > 128) return false;
  // Allow alphanumerics, dashes and underscores only.
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Resolves the request id for an incoming request: reuse an existing,
 * well-formed `x-request-id` header if present (useful when a gateway or
 * load balancer already assigned one), otherwise mint a new one.
 */
export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(incoming) ? incoming : generateRequestId();
}
