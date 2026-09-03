/**
 * The instance configuration document, stored in
 * `Organization.config`.
 *
 * This is the mechanism D-036/D-037 rest on: one VERSIONED, typed, server-
 * validated JSON document holds every runtime setting, so a setting can be
 * added without a migration per field, and so an administrator can change it at
 * runtime without a restart or an environment variable. Only the three
 * bootstrap values in `.env.example` are environment variables.
 *
 * Two parse paths, on purpose:
 *   - {@link coerceOrganizationConfig} — LENIENT, for READS. Never throws; fills
 *     defaults and drops malformed values. An old, partial or corrupt document
 *     must never break rendering or the authentication path. Also
 *     forward-migrates by `version`.
 *   - {@link validateOrganizationConfigInput} — STRICT, for WRITES. Throws
 *     `ApiError("VALIDATION_ERROR")` with a field path on any invalid value, so
 *     nothing untrusted from an admin form is ever persisted.
 *
 * SETTING CLASSES (D-150, as corrected by D-171 and D-173). Every setting is
 * `free`, `bounded` or `invariant`. The session timeouts below are `bounded`:
 * they carry hard floors and ceilings enforced by this schema, which a future
 * `settings:reset` must also respect. An operator with a legitimate reason to
 * exceed a bound changes code, not a setting.
 *
 * SECURITY: text fields are trimmed and length-bounded; the support email is
 * validated against a conservative address pattern. None of these values is
 * ever interpolated into markup or CSS.
 */

import { ApiError, type ApiErrorDetail } from "@/lib/errors";
import { isLocale, locales, type Locale } from "@/i18n/config";

/**
 * Current schema version of the document. Bump this — and add a branch to
 * {@link coerceOrganizationConfig} — whenever the shape changes. A stored older
 * document simply lacks the newer sections and the lenient read fills the safe
 * defaults, so an upgrade needs no data migration.
 *
 * v1 is SplashTrack's first version. The template's document was at v3 and
 * carried `registration` and `cookies` sections; neither is extracted (public
 * self-registration is out of v1, and the cookie-consent banner is a phase-4
 * surface), so this restarts at 1 rather than inheriting a version history for
 * sections that never existed here.
 */
export const ORGANIZATION_CONFIG_VERSION = 1;

/**
 * Closed set of date/time presentation styles. Each maps to a fixed
 * `Intl.DateTimeFormat` option set (see `dateFormatOptions` in `format.ts`) —
 * an administrator never supplies raw format tokens, so there is no
 * format-string injection surface.
 */
export const DATE_FORMATS = ["short", "medium", "long"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/**
 * Clock convention for time display. `system` follows the locale's own
 * convention; `24h` / `12h` force it regardless of locale.
 */
export const TIME_FORMATS = ["system", "24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];

/**
 * First day of the week for calendars and date pickers. The default follows
 * Dutch/European practice (Monday), which is also what a lesson schedule
 * assumes.
 */
export const FIRST_DAYS_OF_WEEK = ["monday", "sunday", "saturday"] as const;
export type FirstDayOfWeek = (typeof FIRST_DAYS_OF_WEEK)[number];

/** Re-exported so an editor can offer the locale choices without a second import. */
export { locales, type Locale } from "@/i18n/config";

/**
 * Validates an IANA time-zone string by attempting to construct a formatter
 * with it — the portable check, with no dependency on `Intl.supportedValuesOf`.
 */
export function isValidTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Length bounds for the plain-text fields (enforced at the validation layer). */
export const CONFIG_TEXT_MAX = {
  /** Search engines truncate descriptions around 160 chars; 320 is generous. */
  metaDescription: 320,
  /** RFC 5321 caps an address at 254 octets. */
  supportEmail: 254,
  /** A short explanatory banner, not a full outage report. */
  maintenanceMessage: 500,
} as const;

/* ---------------------------------------------------------------------------
 * Session timeouts (D-173, superseding D-158).
 *
 * `02-security-privacy.md` §4.1.2 is the ONE home for these numbers and these
 * bounds (D-134). The table below is that section's table, and nothing else in
 * this repository may restate it.
 *
 * These are the TEMPLATE's constants, narrowed — not a new mechanism. The
 * template shipped `{ min: 15, max: 43_200, default: 720 }` for the absolute
 * cap and `{ min: 1, max: 43_200, default: 30 }` for the idle window; 30-day
 * maxima are generous for a general-purpose application and far outside what D-150 intends
 * for a system holding children's records.
 * ------------------------------------------------------------------------- */

/**
 * Session ABSOLUTE timeout, in minutes: a session may not be renewed beyond
 * this age regardless of activity. Enforced live in `@/lib/auth/session.ts`.
 *
 * Ceiling is 24 h, resolving a contradiction D-173 records: D-150's table said
 * absolute ≤ 12 h while D-158 and OD-6 said default 12 h with a 24 h ceiling. A
 * `bounded` setting whose ceiling equals its default cannot be raised, which
 * makes it an invariant filed in the wrong class — and the owner's answer to
 * OD-6 was explicitly "make it a setting an admin can change later".
 */
export const SESSION_TIMEOUT_MINUTES = {
  min: 60,
  max: 1_440,
  default: 720,
} as const;

/**
 * Session IDLE timeout, in minutes, for a STANDARD principal: the session is
 * rejected once this long has passed with no activity. Enforced LIVE in
 * `@/lib/auth/session.ts` as a SECOND, independent check alongside the absolute
 * timeout — first to fail wins.
 *
 * Must never exceed `SESSION_TIMEOUT_MINUTES` (cross-field rule below): an idle
 * window longer than the absolute cap could never take effect, and would
 * mislead an administrator into thinking idle enforcement is looser than it is.
 */
export const SESSION_IDLE_TIMEOUT_MINUTES = {
  min: 5,
  max: 480,
  default: 30,
} as const;

/**
 * Session IDLE timeout, in minutes, for an ELEVATED principal — one holding any
 * permission in the high-risk set (`02-security-privacy.md` §1.2).
 *
 * D-173's whole point: the shorter window is selected by PERMISSION, never by
 * role name. D-130 forbids binding a security control to a role name because
 * roles are user-definable and the starter catalogue is "a starting point, not
 * a fixed object" — a school inventing *Hulpinstructeur* would otherwise put
 * the wet-tablet session on an unchosen fallback, re-creating the
 * self-declaration defect D-143 exists to remove.
 *
 * Strictest wins on any overlap, and an unrecognised principal gets the
 * strictest.
 *
 * PHASE 1 — the PREDICATE now exists; the WIRING does not. Phase 0.4b built
 * the high-risk set and `holdsAnyHighRiskPermission()`
 * (`@/lib/authorization`), so D-173's selection is now one call. It is
 * deliberately not made here yet, and the reason is the hot path rather than
 * the rule: `session.ts` reads the policy on EVERY request, and adding a
 * database query per session read is a caching decision on the busiest path in
 * the application — not something to slip into the pass that built the
 * predicate.
 *
 * So the gap is narrower than it was and still real: every principal currently
 * gets the standard window, which is the LOOSER of the two for an elevated one.
 * Named here rather than hidden. Recorded in
 * `docs/build/phase-0.4b-reach-and-retention-report.md` §5.
 */
export const SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES = {
  min: 5,
  max: 480,
  default: 15,
} as const;

/**
 * A conservative, deliberately simple email shape — a non-empty local part, an
 * `@`, and a dotted domain. FORMAT only; no deliverability check is implied.
 */
export const SUPPORT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The typed configuration document. */
export interface OrganizationConfig {
  version: number;
  seo: {
    /** `<meta name="description">` / OpenGraph description. Null ⇒ none emitted. */
    metaDescription: string | null;
  };
  contact: {
    /** Public support address shown in the footer. Null ⇒ none shown. */
    supportEmail: string | null;
  };
  localization: {
    /**
     * Default locale for visitors with no explicit `locale` cookie. Null ⇒ the
     * built-in default (`defaultLocale` from `@/i18n/config`, which is `nl`).
     */
    defaultLocale: Locale | null;
    /** IANA time zone used to render timestamps. Null ⇒ the server's zone. */
    timeZone: string | null;
    /** Presentation style for dates/times (closed enum → fixed Intl options). */
    dateFormat: DateFormat;
    /** Clock convention: follow the locale, or force 24-hour / AM-PM. */
    timeFormat: TimeFormat;
    /** First day of the week for calendars and lesson schedules. */
    firstDayOfWeek: FirstDayOfWeek;
  };
  security: {
    /** Absolute session cap in minutes (D-173). */
    sessionAbsoluteTimeoutMinutes: number;
    /** Idle window in minutes for a standard principal (D-173). */
    sessionIdleTimeoutMinutes: number;
    /**
     * Idle window in minutes for a principal holding any high-risk permission
     * (D-173). See `SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES` — the selection
     * between this and the standard value is phase 0.4.
     */
    sessionIdleTimeoutMinutesElevated: number;
  };
  maintenance: {
    /**
     * When true, ordinary visitors see a maintenance page instead of the app.
     * An administrator always bypasses it, so it can be turned back off.
     */
    enabled: boolean;
    /**
     * Administrator-authored message shown to visitors. Null ⇒ the built-in
     * translated copy. Plain text only — always rendered escaped, never markup.
     */
    message: string | null;
  };
}

/** The safe default document applied to an instance with no config yet. */
export function defaultOrganizationConfig(): OrganizationConfig {
  return {
    version: ORGANIZATION_CONFIG_VERSION,
    seo: { metaDescription: null },
    contact: { supportEmail: null },
    localization: {
      defaultLocale: null,
      timeZone: null,
      dateFormat: "medium",
      timeFormat: "system",
      firstDayOfWeek: "monday",
    },
    security: {
      sessionAbsoluteTimeoutMinutes: SESSION_TIMEOUT_MINUTES.default,
      sessionIdleTimeoutMinutes: SESSION_IDLE_TIMEOUT_MINUTES.default,
      sessionIdleTimeoutMinutesElevated:
        SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.default,
    },
    maintenance: {
      enabled: false,
      message: null,
    },
  };
}

/* ======================= LENIENT read-path coercion ======================= */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Coerces a raw value to a trimmed, length-bounded string, or null. */
function coerceText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Coerces a raw value to a valid, length-bounded email, or null. */
function coerceEmail(value: unknown): string | null {
  const text = coerceText(value, CONFIG_TEXT_MAX.supportEmail);
  return text && SUPPORT_EMAIL_PATTERN.test(text) ? text : null;
}

/** Coerces a stored minutes value against its bounds, falling back to `fallback`. */
function coerceBoundedMinutes(
  value: unknown,
  bounds: { min: number; max: number },
  fallback: number,
): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= bounds.min && n <= bounds.max
    ? n
    : fallback;
}

/**
 * Parses a stored `Organization.config` JSON value into a complete, valid document,
 * filling defaults for anything missing or invalid. Never throws — this runs on
 * the authentication hot path and on every rendered page.
 */
export function coerceOrganizationConfig(raw: unknown): OrganizationConfig {
  if (raw == null) return defaultOrganizationConfig();

  const defaults = defaultOrganizationConfig();
  const root = asRecord(raw);
  const seo = asRecord(root.seo);
  const contact = asRecord(root.contact);
  const localization = asRecord(root.localization);
  const security = asRecord(root.security);
  const maintenance = asRecord(root.maintenance);

  const rawTimeZone =
    typeof localization.timeZone === "string"
      ? localization.timeZone.trim()
      : "";

  return {
    version: ORGANIZATION_CONFIG_VERSION,
    seo: {
      metaDescription: coerceText(
        seo.metaDescription,
        CONFIG_TEXT_MAX.metaDescription,
      ),
    },
    contact: {
      supportEmail: coerceEmail(contact.supportEmail),
    },
    localization: {
      defaultLocale:
        typeof localization.defaultLocale === "string" &&
        isLocale(localization.defaultLocale)
          ? localization.defaultLocale
          : null,
      timeZone: isValidTimeZone(rawTimeZone) ? rawTimeZone : null,
      dateFormat:
        typeof localization.dateFormat === "string" &&
        (DATE_FORMATS as readonly string[]).includes(localization.dateFormat)
          ? (localization.dateFormat as DateFormat)
          : defaults.localization.dateFormat,
      timeFormat:
        typeof localization.timeFormat === "string" &&
        (TIME_FORMATS as readonly string[]).includes(localization.timeFormat)
          ? (localization.timeFormat as TimeFormat)
          : defaults.localization.timeFormat,
      firstDayOfWeek:
        typeof localization.firstDayOfWeek === "string" &&
        (FIRST_DAYS_OF_WEEK as readonly string[]).includes(
          localization.firstDayOfWeek,
        )
          ? (localization.firstDayOfWeek as FirstDayOfWeek)
          : defaults.localization.firstDayOfWeek,
    },
    // Every timeout falls back to its DEFAULT on a malformed stored value, not
    // to its ceiling. The stricter fallback — falling back to `min` — belongs to
    // the ERROR path in `getRequestConfigData`, where the document could not be
    // read at all; see that function's doc comment for why the two differ.
    security: {
      sessionAbsoluteTimeoutMinutes: coerceBoundedMinutes(
        security.sessionAbsoluteTimeoutMinutes,
        SESSION_TIMEOUT_MINUTES,
        defaults.security.sessionAbsoluteTimeoutMinutes,
      ),
      sessionIdleTimeoutMinutes: coerceBoundedMinutes(
        security.sessionIdleTimeoutMinutes,
        SESSION_IDLE_TIMEOUT_MINUTES,
        defaults.security.sessionIdleTimeoutMinutes,
      ),
      sessionIdleTimeoutMinutesElevated: coerceBoundedMinutes(
        security.sessionIdleTimeoutMinutesElevated,
        SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES,
        defaults.security.sessionIdleTimeoutMinutesElevated,
      ),
    },
    maintenance: {
      enabled: maintenance.enabled === true,
      message: coerceText(
        maintenance.message,
        CONFIG_TEXT_MAX.maintenanceMessage,
      ),
    },
  };
}

/* ======================= STRICT write-path validation ===================== */

function fail(field: string, issue: string): never {
  const detail: ApiErrorDetail = { field, issue };
  throw new ApiError(
    "VALIDATION_ERROR",
    "The submitted settings are invalid.",
    {
      details: [detail],
    },
  );
}

/** Strict optional text: allows null, trims, rejects over-length. */
function strictTextOrNull(
  field: string,
  value: unknown,
  max: number,
): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field, "Must be text.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) fail(field, `Must be at most ${max} characters.`);
  return trimmed;
}

/** Strict optional email: allows null, validates format and length. */
function strictEmailOrNull(field: string, value: unknown): string | null {
  const text = strictTextOrNull(field, value, CONFIG_TEXT_MAX.supportEmail);
  if (text == null) return null;
  if (!SUPPORT_EMAIL_PATTERN.test(text)) {
    fail(field, "Must be a valid email address like support@example.com.");
  }
  return text;
}

/** Strict optional locale: null (use the built-in default) or a supported one. */
function strictLocaleOrNull(field: string, value: unknown): Locale | null {
  if (value == null || value === "") return null;
  if (!isLocale(typeof value === "string" ? value : undefined)) {
    fail(field, `Must be one of: ${locales.join(", ")}.`);
  }
  return value as Locale;
}

/** Strict optional time zone: null (server zone) or a valid IANA zone. */
function strictTimeZoneOrNull(field: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field, "Must be text.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!isValidTimeZone(trimmed)) {
    fail(field, "Must be a valid IANA time zone like Europe/Amsterdam.");
  }
  return trimmed;
}

/** Strict member of a closed string enum. */
function strictEnum<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    fail(field, `Must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/**
 * Strict bounded integer minutes. These are security-critical caps, not
 * convenience settings, so an out-of-range or non-integer value is REFUSED
 * rather than clamped — a silently clamped write would tell the administrator
 * their value was accepted (D-150's `bounded` class).
 */
function strictBoundedMinutes(
  field: string,
  value: unknown,
  bounds: { min: number; max: number },
): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
    fail(
      field,
      `Must be a whole number of minutes between ${bounds.min} and ${bounds.max}.`,
    );
  }
  return n;
}

/** Strict boolean. */
function strictBoolean(field: string, value: unknown): boolean {
  if (typeof value !== "boolean") fail(field, "Must be true or false.");
  return value;
}

/**
 * Validates an untrusted (partial) settings document, merged over the current
 * document, into a complete valid document. Throws `ApiError("VALIDATION_ERROR")`
 * on the first invalid field. Missing sections inherit from `current`, so a
 * section-scoped save need not resend everything.
 */
export function validateOrganizationConfigInput(
  input: unknown,
  current: OrganizationConfig,
): OrganizationConfig {
  const root = asRecord(input);
  const seo = { ...current.seo, ...asRecord(root.seo) };
  const contact = { ...current.contact, ...asRecord(root.contact) };
  const localization = {
    ...current.localization,
    ...asRecord(root.localization),
  };
  const security = { ...current.security, ...asRecord(root.security) };
  const maintenance = { ...current.maintenance, ...asRecord(root.maintenance) };

  const validatedSecurity = {
    sessionAbsoluteTimeoutMinutes: strictBoundedMinutes(
      "security.sessionAbsoluteTimeoutMinutes",
      security.sessionAbsoluteTimeoutMinutes,
      SESSION_TIMEOUT_MINUTES,
    ),
    sessionIdleTimeoutMinutes: strictBoundedMinutes(
      "security.sessionIdleTimeoutMinutes",
      security.sessionIdleTimeoutMinutes,
      SESSION_IDLE_TIMEOUT_MINUTES,
    ),
    sessionIdleTimeoutMinutesElevated: strictBoundedMinutes(
      "security.sessionIdleTimeoutMinutesElevated",
      security.sessionIdleTimeoutMinutesElevated,
      SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES,
    ),
  };

  // Cross-field, inherited from the template and kept by D-173: an idle timeout
  // longer than the absolute timeout could never take effect — the absolute cap
  // would always reject the session first — and would only mislead an
  // administrator into thinking idle enforcement is looser than it is. Checked
  // for BOTH idle values; the elevated one is the shorter of the two in every
  // sane configuration, but nothing in the bounds forces that.
  for (const key of [
    "sessionIdleTimeoutMinutes",
    "sessionIdleTimeoutMinutesElevated",
  ] as const) {
    if (
      validatedSecurity[key] > validatedSecurity.sessionAbsoluteTimeoutMinutes
    ) {
      fail(`security.${key}`, "Must not exceed the absolute session timeout.");
    }
  }

  return {
    version: ORGANIZATION_CONFIG_VERSION,
    seo: {
      metaDescription: strictTextOrNull(
        "seo.metaDescription",
        seo.metaDescription,
        CONFIG_TEXT_MAX.metaDescription,
      ),
    },
    contact: {
      supportEmail: strictEmailOrNull(
        "contact.supportEmail",
        contact.supportEmail,
      ),
    },
    localization: {
      defaultLocale: strictLocaleOrNull(
        "localization.defaultLocale",
        localization.defaultLocale,
      ),
      timeZone: strictTimeZoneOrNull(
        "localization.timeZone",
        localization.timeZone,
      ),
      dateFormat: strictEnum(
        "localization.dateFormat",
        localization.dateFormat,
        DATE_FORMATS,
      ),
      timeFormat: strictEnum(
        "localization.timeFormat",
        localization.timeFormat,
        TIME_FORMATS,
      ),
      firstDayOfWeek: strictEnum(
        "localization.firstDayOfWeek",
        localization.firstDayOfWeek,
        FIRST_DAYS_OF_WEEK,
      ),
    },
    security: validatedSecurity,
    maintenance: {
      enabled: strictBoolean("maintenance.enabled", maintenance.enabled),
      message: strictTextOrNull(
        "maintenance.message",
        maintenance.message,
        CONFIG_TEXT_MAX.maintenanceMessage,
      ),
    },
  };
}
