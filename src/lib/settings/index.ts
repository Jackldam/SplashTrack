/**
 * Instance settings entry point.
 *
 * D-036/D-037: every runtime setting is database-backed and administrator-
 * editable; only the three bootstrap values in `.env.example` are environment
 * variables. This module owns the document that holds them.
 *
 * Phase 0.2 exports the READ paths and the schema. The guarded admin surface
 * (read-for-edit and the permission-checked writes) arrives with the
 * `requirePermission` guard in phase 0.4 — see `./settings.ts` for why the cut
 * falls there.
 */

export {
  PLATFORM_CONFIG_VERSION,
  CONFIG_TEXT_MAX,
  SUPPORT_EMAIL_PATTERN,
  DATE_FORMATS,
  TIME_FORMATS,
  FIRST_DAYS_OF_WEEK,
  SESSION_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES,
  locales,
  isValidTimeZone,
  defaultPlatformConfig,
  coercePlatformConfig,
  validatePlatformConfigInput,
  type PlatformConfig,
  type DateFormat,
  type TimeFormat,
  type FirstDayOfWeek,
  type Locale,
} from "./config";

export { dateFormatOptions, formatDateTime } from "./format";

export {
  PLATFORM_SETTINGS_ID,
  getPublicPlatformConfig,
  getRequestConfigData,
  getConfiguredLocalization,
  getConfiguredSecurityPolicy,
  writePlatformConfig,
  type PublicPlatformSettings,
} from "./settings";
