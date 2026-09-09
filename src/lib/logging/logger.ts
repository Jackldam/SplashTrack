/**
 * Structured application logging.
 *
 * This is APPLICATION logging: troubleshooting, performance analysis, error
 * investigation, operational monitoring.
 *
 * It is deliberately NOT audit logging. The audit trail (`@/modules/audit`,
 * D-149) is a separate, business-logic-specific concern: it records security-
 * and privacy-sensitive actions, has different required fields (actor, target
 * resource, outcome, reason), is append-only and hash-chained, and carries its
 * own retention rules. Do not repurpose this logger for audit events, and never
 * treat a log line as evidence that an audited action was recorded.
 *
 * Rules enforced here:
 *   - never log authentication secrets, passwords, bearer tokens, session
 *     cookies, or other obviously sensitive values;
 *   - never log a personal-data VALUE — a child's name, a medical remark, a
 *     contact address. Identifiers only;
 *   - always emit structured (JSON) logs;
 *   - always carry the request id when one is available, so log lines can be
 *     correlated with a specific request (`@/lib/api/request-id`).
 */

import pino from "pino";

/** Keys that must never appear with their real value in a log line. */
const REDACT_PATHS = [
  "password",
  "*.password",
  "req.headers.authorization",
  "req.headers.cookie",
  "token",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "secret",
  "*.secret",
  "*.apiKey",
  "*.api_key",
  "sessionToken",
  "*.sessionToken",
  "*.session_token",
  // Better Auth's `Verification` model (prisma/schema.prisma) stores
  // password-reset / email-verification tokens in its `value` column - if a
  // Verification record is ever spread into a log line, redact it too.
  "Verification.value",
];

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  base: {
    // Avoid leaking the internal hostname/pid by default; add back
    // explicitly if a deployment ever needs it for troubleshooting.
    service: "splashtrack",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty-print in local development only; production emits plain
  // structured JSON suitable for a log aggregator.
  transport:
    !isProduction && !isTest
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

export type Logger = typeof logger;

/**
 * Returns a child logger bound to a specific request id, so every log line
 * emitted while handling a request can be correlated with it. Route Handlers /
 * middleware should call this once per request.
 */
export function loggerForRequest(requestId: string): Logger {
  return logger.child({ requestId });
}
