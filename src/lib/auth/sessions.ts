/**
 * Self-service session management (Architecture.md Section 9.2). Lets a signed-in
 * user see and revoke THEIR OWN active sessions from `/profile`.
 *
 * Built on Better Auth's session endpoints (`listSessions` / `revokeSession` /
 * `revokeOtherSessions`), which are inherently scoped to the CURRENT user via the
 * request headers — a caller can only ever see or revoke their own sessions.
 *
 * SECURITY: a session `token` IS the authentication credential. It is NEVER
 * returned to the client. The UI identifies a session by its opaque row `id`
 * (a primary key, not a credential); this module maps that id → token
 * server-side (from the caller's OWN session list) to perform a revoke, so the
 * token stays on the server and a caller can only target a session that appears
 * in their own list.
 *
 * SERVER-ONLY.
 */

import { headers } from "next/headers";

import { auth } from "./auth";

/** A Better Auth session row as returned by `listSessions` (token omitted here). */
interface RawSession {
  id: string;
  createdAt: Date | string;
  /**
   * Better Auth's own sliding-refresh timestamp (FD-AUTHN-30a). Bumped at most
   * once per `updateAge` (see `@/lib/auth/auth.ts`) — a coarse "seen recently"
   * proxy, NOT a per-request last-activity timestamp. `toMySessionInfo` passes
   * this through as-is; `SessionsPanel` is responsible for presenting it with
   * honest, approximate wording rather than as an exact time.
   */
  updatedAt: Date | string;
  expiresAt: Date | string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Non-secret view of one of the caller's sessions, safe to send to the client. */
export interface MySessionInfo {
  /** Opaque row id — NOT the session token. Used to target a revoke. */
  id: string;
  /** True for the session making this request (cannot be revoked from here). */
  current: boolean;
  createdAt: Date;
  /** See {@link RawSession.updatedAt} — a coarse, periodically-bumped "last
   * seen" proxy (FD-AUTHN-30a), not an exact per-request timestamp. */
  updatedAt: Date;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Pure mapping of raw Better Auth sessions to the non-secret client view: strips
 * the token, marks the current session, and orders current-first then
 * newest-first. Exported for unit testing.
 */
export function toMySessionInfo(
  sessions: RawSession[],
  currentSessionId: string,
): MySessionInfo[] {
  return sessions
    .map((s) => ({
      id: s.id,
      current: s.id === currentSessionId,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
      expiresAt: new Date(s.expiresAt),
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
    }))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
}

/**
 * Lists the caller's own active sessions (token never included).
 *
 * Note: these are filtered only by Better Auth's own `expiresAt`. A session past
 * the ADMIN-configured absolute timeout (`getConfiguredSecurityPolicy`, enforced
 * in `getCurrentSession`) but not yet past Better Auth's expiry may still appear
 * here — harmless (it grants no access on use, and revoking it is safe), just a
 * cosmetic accuracy limit of the panel.
 */
export async function listMySessions(
  currentSessionId: string,
): Promise<MySessionInfo[]> {
  const sessions = await auth.api.listSessions({ headers: await headers() });
  return toMySessionInfo(sessions as RawSession[], currentSessionId);
}

/** Outcome of a single-session revoke. */
export type RevokeSessionResult = "OK" | "NOT_FOUND" | "IS_CURRENT";

/**
 * Revokes ONE of the caller's own sessions, identified by its row id. Refuses to
 * revoke the current session (that is what "sign out" is for). The id is resolved
 * to a token from the caller's OWN session list, so an arbitrary/foreign token
 * can never be supplied.
 */
export async function revokeMySessionById(
  currentSessionId: string,
  sessionId: string,
): Promise<RevokeSessionResult> {
  if (sessionId === currentSessionId) return "IS_CURRENT";
  const hdrs = await headers();
  const sessions = (await auth.api.listSessions({ headers: hdrs })) as Array<
    RawSession & { token: string }
  >;
  const target = sessions.find((s) => s.id === sessionId);
  if (!target) return "NOT_FOUND";
  await auth.api.revokeSession({
    headers: hdrs,
    body: { token: target.token },
  });
  return "OK";
}

/** Revokes every session EXCEPT the current one. */
export async function revokeMyOtherSessions(): Promise<void> {
  await auth.api.revokeOtherSessions({ headers: await headers() });
}
