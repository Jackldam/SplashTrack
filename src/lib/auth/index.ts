/**
 * Auth entry point.
 *
 * Import the Better Auth instance and the typed session helpers from here
 * (`@/lib/auth`) rather than reaching into individual files.
 *
 * This proves IDENTITY. It does not authorize anything — `requirePermission`
 * and `resolveReach` (D-147) are phase 0.4 and will live in their own module,
 * deliberately not behind this barrel.
 */

export {
  auth,
  type Auth,
  PASSWORD_POLICY,
  BETTER_AUTH_COOKIE_ATTRIBUTES,
  personCreationTracker,
  reauthenticationMarker,
  hashToken,
} from "./auth";

export {
  getCurrentSession,
  requireCurrentSession,
  revokeAllSessionsForUser,
  SESSION_ABSOLUTE_TIMEOUT_SECONDS,
  type CurrentSession,
  type CurrentUserAccount,
  type CurrentPerson,
} from "./session";

export {
  listMySessions,
  revokeMySessionById,
  revokeMyOtherSessions,
  toMySessionInfo,
  type MySessionInfo,
  type RevokeSessionResult,
} from "./sessions";

export { forwardCookies } from "./cookies";
