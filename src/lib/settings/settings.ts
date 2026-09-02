/**
 * Instance settings — the READ paths.
 *
 * Reads and writes the configuration document stored in
 * `PlatformSettings.platformConfig` (a `@@id`-keyed singleton row).
 *
 * ONLY the read paths are extracted in phase 0.2, and that is a deliberate cut
 * rather than an omission. The template's guarded read
 * (`getPlatformConfigForEdit`) and its two writes (`updatePlatformConfig`,
 * `updateSessionPolicy`) each call `requirePlatformPermission` — the platform
 * super-administrator exception path, which D-056 deletes, sitting on top of the
 * permission guard, which is phase 0.4 (D-147). Bringing them across now would
 * mean bringing a half-matching guard with them. The settings ADMIN SURFACE
 * arrives with that guard; until then this file answers "what is configured",
 * and nothing can change it from inside the application.
 *
 * The reads below are what the rest of the foundation depends on:
 *   - `getRequestConfigData` runs on EVERY request (the i18n request path and
 *     the session helper both call it).
 *   - `getConfiguredSecurityPolicy` is what makes the session timeouts live and
 *     administrator-configurable rather than constants (D-173).
 *
 * SERVER-ONLY.
 */

import { cache } from "react";

import { Prisma, prisma } from "@/lib/database";
import { logger } from "@/lib/logging";

import {
  SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MINUTES,
  coercePlatformConfig,
  defaultPlatformConfig,
  validatePlatformConfigInput,
  type PlatformConfig,
} from "./config";

const settingsLogger = logger.child({ component: "settings" });

/**
 * The fixed primary key of the settings singleton. One organisation per
 * installation (D-162), so there is exactly one row and its id is a constant
 * rather than a lookup.
 *
 * Phase 0.3 enforces the singleton at the DATABASE rather than by convention.
 * This constant is the convention it replaces, not a substitute for it.
 */
export const PLATFORM_SETTINGS_ID = "platform";

/** The public, render-only settings shape: the coerced config document. */
export interface PublicPlatformSettings {
  config: PlatformConfig;
}

/**
 * Ensures the singleton row exists and returns the settings-relevant columns.
 * A lazy fixed-id upsert, so concurrent first reads cannot create two rows.
 */
async function getOrCreatePlatformSettings() {
  return prisma.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: { id: PLATFORM_SETTINGS_ID },
    select: {
      platformConfig: true,
      updatedAt: true,
      updatedByPersonId: true,
    },
  });
}

/**
 * UNGUARDED public read, used to render the meta description and support
 * contact. Requires no permission — these values render for every visitor.
 *
 * Wrapped in `React.cache()` so several callers on the same request share one
 * query instead of each triggering their own upsert. Deduping is safe: nothing
 * else writes this row mid-request.
 */
export const getPublicPlatformConfig = cache(
  async (): Promise<PublicPlatformSettings> => {
    const settings = await getOrCreatePlatformSettings();
    return { config: coercePlatformConfig(settings.platformConfig) };
  },
);

/**
 * Data the i18n request path (`src/i18n/request.ts`) AND the session helper
 * (`@/lib/auth/session.ts`) need on EVERY request: the configured display name
 * (so every `brand` message reference is dynamic), the localization section,
 * and the security policy. Read together in ONE `findUnique` — NOT the lazy
 * upsert, so this never writes on a hot path — and wrapped in `React.cache` so
 * every consumer in a single request shares one query.
 *
 * `brandName` is null when the singleton does not exist yet; leave the built-in
 * message default in place. Any read error degrades to null plus the DEFAULT
 * localization: this runs on every request including the login page, before any
 * account exists, so a transient database blip must not take down every page.
 *
 * THE SECURITY POLICY FALLBACK IS DELIBERATELY NOT THE SAME "SAFE" DEFAULT, and
 * this asymmetry is the whole point. Falling back to the `default` timeout would
 * silently WIDEN an administrator-shortened cap back to 12 h for as long as the
 * blip lasts — the opposite of fail-safe for a security control. On error every
 * timeout falls back to its FLOOR (the strictest allowed value), so a read
 * failure can only ever make sessions expire SOONER than configured, never
 * later. These are POST-LOGIN checks, so failing strict signs someone out
 * earlier than configured and nothing worse; they can sign in again.
 *
 * Do not "harmonise" this with a fail-open elsewhere. A control that gates
 * LOGIN ITSELF has the opposite correct direction — failing closed there could
 * lock every user out of the only working sign-in method, with the
 * administrator unable to reach the page that would fix it.
 */
export const getRequestConfigData = cache(
  async (): Promise<{
    brandName: string | null;
    localization: PlatformConfig["localization"];
    security: PlatformConfig["security"];
  }> => {
    try {
      const row = await prisma.platformSettings.findUnique({
        where: { id: PLATFORM_SETTINGS_ID },
        select: { displayName: true, platformConfig: true },
      });
      const config = coercePlatformConfig(row?.platformConfig);
      return {
        brandName: row?.displayName ?? null,
        localization: config.localization,
        security: config.security,
      };
    } catch (error) {
      settingsLogger.warn(
        { err: error, event: "settings.request_config_read_failed" },
        "request-config read failed; falling back to defaults, and to the " +
          "STRICTEST session bounds",
      );
      const defaults = defaultPlatformConfig();
      return {
        brandName: null,
        localization: defaults.localization,
        // Floors, not defaults — see the doc comment above.
        security: {
          sessionAbsoluteTimeoutMinutes: SESSION_TIMEOUT_MINUTES.min,
          sessionIdleTimeoutMinutes: SESSION_IDLE_TIMEOUT_MINUTES.min,
          sessionIdleTimeoutMinutesElevated:
            SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.min,
        },
      };
    }
  },
);

/**
 * UNGUARDED, read-only localization resolver. Delegates to
 * {@link getRequestConfigData} so it shares the same cached query.
 */
export async function getConfiguredLocalization(): Promise<
  PlatformConfig["localization"]
> {
  return (await getRequestConfigData()).localization;
}

/**
 * UNGUARDED, read-only security-policy resolver — called on EVERY authenticated
 * request by `getCurrentSession()` to learn the current session timeouts.
 * Delegates to {@link getRequestConfigData} so it shares the same cached,
 * fail-safe-to-strict query and never hard-fails the auth path.
 */
export async function getConfiguredSecurityPolicy(): Promise<
  PlatformConfig["security"]
> {
  return (await getRequestConfigData()).security;
}

/**
 * Writes a validated configuration document, recording who changed it.
 *
 * DELIBERATELY NOT EXPORTED from `@/lib/settings`, and deliberately taking an
 * already-resolved `updatedByPersonId` rather than a principal: this function
 * performs NO authorization of its own. The guarded admin surface that will
 * call it — after `requirePermission` (D-147) — is phase 0.4. It exists now
 * only so the strict validator has an exercised write path and so the shape of
 * the eventual service is fixed rather than invented later.
 *
 * Callers must be inside an already-authorized code path. There is none in
 * phase 0.2.
 */
export async function writePlatformConfig(
  input: unknown,
  updatedByPersonId: string | null,
): Promise<PublicPlatformSettings> {
  const currentRow = await getOrCreatePlatformSettings();
  const current = coercePlatformConfig(currentRow.platformConfig);
  const validated = validatePlatformConfigInput(input, current);

  const updated = await prisma.platformSettings.update({
    where: { id: PLATFORM_SETTINGS_ID },
    data: {
      // PlatformConfig is a plain, JSON-serialisable document.
      platformConfig: validated as unknown as Prisma.InputJsonValue,
      updatedByPersonId,
    },
    select: { platformConfig: true },
  });

  return { config: coercePlatformConfig(updated.platformConfig) };
}
