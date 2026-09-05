/**
 * Rate-limit utility entry point. A small DB-backed fixed-window limiter for
 * abuse-prone unauthenticated actions (public-registration.md). Import from
 * here (`@/lib/rate-limit`) rather than the internal file.
 */

export {
  consumeRateLimit,
  hashRateLimitId,
  sweepStaleRateLimitCounters,
  type RateLimitRule,
} from "./rate-limit";
export { getClientIp, resolveClientIp } from "./client-ip";
