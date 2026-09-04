/**
 * Instance settings — the READ paths.
 *
 * Reads and writes the configuration document stored in `Organization.config`,
 * on the organisation singleton. Phase 0.3 merged the inherited
 * `PlatformSettings` table into `Organization` (D-056): one organisation per
 * installation leaves no second side to a platform-versus-organisation settings
 * duality, so there is one row, one document and one name.
 *
 * ONLY the read paths are extracted, and that is a deliberate cut rather than an
 * omission. The template's guarded read and its two writes each called
 * `requirePlatformPermission` — the platform super-administrator exception path,
 * which D-056 deletes, sitting on top of the permission guard, which is phase
 * 0.4 (D-147). Bringing them across would have meant bringing a half-matching
 * guard with them, and the exception path has no meaning here: there is no
 * platform and no principal above the organisation.
 *
 * PHASE 1: the settings ADMIN SURFACE. `requirePermission` now EXISTS
 * (`@/lib/authorization`, phase 0.4b), so the blocker this comment named is
 * gone; what is left is a screen, and phase 0.4 builds no screens. When it
 * arrives the guard is `requirePermission(principal,
 * 'organization.settings.manage', { organization: true })`, and D-150's
 * `bounded`/`invariant` classification is what the WRITE path enforces on top
 * of it. Until then this file answers "what is configured", and nothing can
 * change it from inside the application.
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
  coerceOrganizationConfig,
  defaultOrganizationConfig,
  validateOrganizationConfigInput,
  type OrganizationConfig,
} from "./config";

const settingsLogger = logger.child({ component: "settings" });

/**
 * The fixed primary key of the organisation singleton. One organisation per
 * installation (D-162), so there is exactly one row and its id is a constant
 * rather than a lookup.
 *
 * NOT the enforcement. A CHECK constraint on `Organization.id` pins the column
 * to this same value in the database, so a second organisation cannot be
 * inserted even by code that never imports this constant — see the model's doc
 * comment and `tests/integration/organization-singleton.test.ts`. This is the
 * convenience; the constraint is the control.
 */
export const ORGANIZATION_ID = "organization";

/** The public, render-only settings shape: the coerced config document. */
export interface PublicOrganizationSettings {
  config: OrganizationConfig;
}

/**
 * Ensures the singleton row exists and returns the settings-relevant columns.
 * A lazy fixed-id upsert, so concurrent first reads cannot create two rows.
 *
 * PHASE 1: the setup wizard (D-039) must UPDATE this row and must not read its
 * existence as "the installation is configured" — this read creates it. The
 * boot state machine reads `InstallationBootstrap` (D-100) for that.
 */
async function getOrCreateOrganization() {
  return prisma.organization.upsert({
    where: { id: ORGANIZATION_ID },
    update: {},
    create: { id: ORGANIZATION_ID },
    select: {
      config: true,
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
export const getPublicOrganizationConfig = cache(
  async (): Promise<PublicOrganizationSettings> => {
    const organization = await getOrCreateOrganization();
    return { config: coerceOrganizationConfig(organization.config) };
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
    localization: OrganizationConfig["localization"];
    security: OrganizationConfig["security"];
    privacy: OrganizationConfig["privacy"];
  }> => {
    try {
      const row = await prisma.organization.findUnique({
        where: { id: ORGANIZATION_ID },
        select: { name: true, config: true },
      });
      const config = coerceOrganizationConfig(row?.config);
      return {
        brandName: row?.name ?? null,
        localization: config.localization,
        security: config.security,
        // Carried on the SAME cached query rather than a second one. D-151's
        // derivation runs wherever a guardian relationship is displayed or
        // relied on — a person screen, not a hot path — but this read is made
        // anyway and deduped per request, so adding one field to a `select`
        // that already runs costs nothing where a second `findUnique` would
        // cost a round trip per screen.
        privacy: config.privacy,
      };
    } catch (error) {
      settingsLogger.warn(
        { err: error, event: "settings.request_config_read_failed" },
        "request-config read failed; falling back to defaults, and to the " +
          "STRICTEST session bounds",
      );
      const defaults = defaultOrganizationConfig();
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
        // The DEFAULT, not a floor. "Strictest" is not a coherent direction for
        // a legal threshold — see `coerceOrganizationConfig`'s note on the same
        // asymmetry. A read failure must not silently apply another member
        // state's age of consent.
        privacy: defaults.privacy,
      };
    }
  },
);

/**
 * UNGUARDED, read-only localization resolver. Delegates to
 * {@link getRequestConfigData} so it shares the same cached query.
 */
export async function getConfiguredLocalization(): Promise<
  OrganizationConfig["localization"]
> {
  return (await getRequestConfigData()).localization;
}

/**
 * UNGUARDED, read-only privacy-policy resolver — today, D-151's age of digital
 * consent. Delegates to {@link getRequestConfigData} so it shares the same
 * cached query.
 *
 * UNGUARDED is correct and is not an oversight. This returns a NUMBER that is
 * the same for the whole installation and discloses nothing about any person;
 * the guarded thing is the relationship the number is applied TO, and that read
 * goes through `requirePermission` in `@/modules/people`.
 */
export async function getConfiguredPrivacyPolicy(): Promise<
  OrganizationConfig["privacy"]
> {
  return (await getRequestConfigData()).privacy;
}

/**
 * UNGUARDED, read-only security-policy resolver — called on EVERY authenticated
 * request by `getCurrentSession()` to learn the current session timeouts.
 * Delegates to {@link getRequestConfigData} so it shares the same cached,
 * fail-safe-to-strict query and never hard-fails the auth path.
 */
export async function getConfiguredSecurityPolicy(): Promise<
  OrganizationConfig["security"]
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
export async function writeOrganizationConfig(
  input: unknown,
  updatedByPersonId: string | null,
): Promise<PublicOrganizationSettings> {
  const currentRow = await getOrCreateOrganization();
  const current = coerceOrganizationConfig(currentRow.config);
  const validated = validateOrganizationConfigInput(input, current);

  const updated = await prisma.organization.update({
    where: { id: ORGANIZATION_ID },
    data: {
      // OrganizationConfig is a plain, JSON-serialisable document.
      config: validated as unknown as Prisma.InputJsonValue,
      updatedByPersonId,
    },
    select: { config: true },
  });

  return { config: coerceOrganizationConfig(updated.config) };
}
