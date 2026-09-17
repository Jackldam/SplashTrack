/**
 * The typed settings registry (R-17, `13-configuration-and-setup.md` §3.2).
 *
 * ONE PLACE PER SETTING. Every entry below carries the whole shape §3.2 names
 * — key, category, type, default, validation (a real `zod` schema — F-108,
 * closed by adding `zod` as a dependency), scope, `appliesLive`, `permission`,
 * `sensitive` and `class` (D-150/D-171) — and this is what the admin UI, the
 * write-path validation AND the diagnostics page all read. Adding a setting
 * means adding an entry here; it does not mean touching a form, a migration
 * and a docs page separately.
 *
 * WHERE A VALUE ACTUALLY LIVES. Nearly every entry maps onto a section/field
 * of `OrganizationConfig` (`@/lib/settings/config.ts`) — the existing
 * versioned JSON document `Organization.config` already is. Two exceptions,
 * both named in the storage descriptor:
 *
 *   - `organization.name` predates the document and is its own column
 *     (`Organization.name`), because it is also the brand name injected over
 *     `common.brand` — storage `{ kind: "organizationName" }`.
 *   - `sensitive: true` entries (today, `email.smtpPassword`) are NEVER
 *     written into the JSON document at all — they live one row per key in
 *     `OrganizationSettingSecret`, encrypted under D-096's envelope
 *     (`settings-secret-v1`, reserved for exactly this in
 *     `@/lib/crypto/secret-key.ts`) — storage `{ kind: "secret" }`. The
 *     service never returns their value to a client, only whether one is set.
 *
 * THE KERNEL, NOT THE WHOLE VOCABULARY. §3.2 asks for "the ~15 settings that
 * matter" as a starting point, not an exhaustive catalogue. What is here and
 * what is not — and why — is stated in the phase report
 * (`docs/build/phase-3.2-settings-diagnostics-report.md`), not restated as a
 * second copy in this comment (D-134).
 *
 * `class: "invariant"` entries carry NO storage at all (`storage: null`):
 * D-171 narrows `invariant` to objects the registry can actually refuse a
 * write to, and "MFA is mandatory for the high-risk permission set" is
 * enforced in code (`@/lib/authorization`'s `HIGH_RISK_PERMISSIONS`), not by
 * a stored flag a `settings:reset` could ever clear. It is listed here
 * because the UI renders an invariant as a STATED FACT beside the settings
 * that are actually editable (§3.2: "a disabled control invites a support
 * question whose answer is 'no'"), and because the diagnostics page reads
 * this same registry for its effective-configuration table.
 */

import { z } from "zod";

import type { PermissionKey } from "@/lib/authorization";
import {
  AGE_OF_DIGITAL_CONSENT_YEARS,
  BACKUP_RETENTION_DAYS,
  CONFIG_TEXT_MAX,
  DATE_FORMATS,
  EMAIL_HOST_MAX,
  ORGANIZATION_NAME_MAX,
  PASSWORD_MIN_LENGTH,
  SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES,
  SESSION_IDLE_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MINUTES,
  SUPPORT_EMAIL_PATTERN,
  isValidOrganizationName,
  locales,
} from "@/lib/settings";

/** §3.2's closed category vocabulary. */
export const SETTING_CATEGORIES = [
  "Organisation",
  "Email",
  "Authentication",
  "Security",
  "Privacy",
  "Appearance",
  "Website",
  "Maintenance",
] as const;
export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

/** D-150's classification. */
export const SETTING_CLASSES = ["free", "bounded", "invariant"] as const;
export type SettingClass = (typeof SETTING_CLASSES)[number];

export const SETTING_TYPES = [
  "string",
  "number",
  "boolean",
  "enum",
  "secret",
] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

/** Where a registry entry's live value actually lives. */
export type SettingStorage =
  | {
      readonly kind: "config";
      readonly section: string;
      readonly field: string;
    }
  | { readonly kind: "organizationName" }
  | { readonly kind: "secret" }
  | { readonly kind: "none" };

export interface SettingDefinition {
  readonly key: string;
  readonly category: SettingCategory;
  readonly type: SettingType;
  /** A real Zod schema (F-108) — the single source of truth for validity. */
  readonly schema: z.ZodTypeAny;
  readonly default: unknown;
  /** §3.2 defines exactly one scope literal today. */
  readonly scope: "instance-wide";
  readonly appliesLive: boolean;
  readonly permission: PermissionKey;
  readonly sensitive: boolean;
  readonly class: SettingClass;
  readonly storage: SettingStorage;
  /** One line, shown in the admin UI and the diagnostics table. */
  readonly description: string;
  /** For `bounded` numeric settings — used by the UI and by `settings:reset`. */
  readonly bounds?: { readonly min?: number; readonly max?: number };
}

const MANAGE: PermissionKey = "organization.settings.manage";

/**
 * THE REGISTRY. Order is documentation only; `SETTINGS_BY_KEY` (below) is what
 * the rest of the code reads, so a duplicate key is a build-time object-key
 * collision rather than a review miss.
 */
export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  // ---------------------------------------------------------------- Organisation
  {
    key: "organization.name",
    category: "Organisation",
    type: "string",
    schema: z
      .string()
      .trim()
      .min(1)
      .max(ORGANIZATION_NAME_MAX)
      .refine(isValidOrganizationName, "Invalid organisation name."),
    default: "SplashTrack",
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "organizationName" },
    description:
      "The organisation's name — also the brand name shown throughout the app.",
  },
  {
    key: "organization.supportEmail",
    category: "Organisation",
    type: "string",
    schema: z
      .string()
      .trim()
      .max(CONFIG_TEXT_MAX.supportEmail)
      .regex(SUPPORT_EMAIL_PATTERN)
      .nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "contact", field: "supportEmail" },
    description: "Public support address shown in the footer.",
  },
  {
    key: "organization.metaDescription",
    category: "Organisation",
    type: "string",
    schema: z.string().trim().max(CONFIG_TEXT_MAX.metaDescription).nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "seo", field: "metaDescription" },
    description: "Meta description / OpenGraph description for search engines.",
  },

  // ---------------------------------------------------------------------- Email
  {
    key: "email.smtpHost",
    category: "Email",
    type: "string",
    schema: z.string().trim().max(EMAIL_HOST_MAX).nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "email", field: "smtpHost" },
    description:
      "SMTP host used to send outbound mail. Empty ⇒ email sending is off.",
  },
  {
    key: "email.smtpPassword",
    category: "Email",
    type: "secret",
    schema: z.string().min(1).max(1024).nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: true,
    class: "free",
    storage: { kind: "secret" },
    description:
      "SMTP credential. Encrypted at rest (D-096); never returned to any client.",
  },

  // ------------------------------------------------------------- Authentication
  {
    key: "authentication.passwordMinLength",
    category: "Authentication",
    type: "number",
    schema: z
      .number()
      .int()
      .min(PASSWORD_MIN_LENGTH.min)
      .max(PASSWORD_MIN_LENGTH.max),
    default: PASSWORD_MIN_LENGTH.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "bounded",
    storage: {
      kind: "config",
      section: "authentication",
      field: "passwordMinLength",
    },
    description: "Minimum local-account password length.",
    bounds: { min: PASSWORD_MIN_LENGTH.min, max: PASSWORD_MIN_LENGTH.max },
  },
  {
    key: "authentication.mfaRequiredForHighRisk",
    category: "Authentication",
    type: "boolean",
    schema: z.literal(true),
    default: true,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "invariant",
    storage: { kind: "none" },
    description:
      "MFA is mandatory for every permission in the high-risk set (D-150). Not editable — enforced in code, not by a stored flag.",
  },

  // -------------------------------------------------------------------- Security
  {
    key: "security.sessionAbsoluteTimeoutMinutes",
    category: "Security",
    type: "number",
    schema: z
      .number()
      .int()
      .min(SESSION_TIMEOUT_MINUTES.min)
      .max(SESSION_TIMEOUT_MINUTES.max),
    default: SESSION_TIMEOUT_MINUTES.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "bounded",
    storage: {
      kind: "config",
      section: "security",
      field: "sessionAbsoluteTimeoutMinutes",
    },
    description:
      "Absolute session lifetime, in minutes: a session may not be renewed past this age regardless of activity (D-173).",
    bounds: {
      min: SESSION_TIMEOUT_MINUTES.min,
      max: SESSION_TIMEOUT_MINUTES.max,
    },
  },
  {
    key: "security.sessionIdleTimeoutMinutes",
    category: "Security",
    type: "number",
    schema: z
      .number()
      .int()
      .min(SESSION_IDLE_TIMEOUT_MINUTES.min)
      .max(SESSION_IDLE_TIMEOUT_MINUTES.max),
    default: SESSION_IDLE_TIMEOUT_MINUTES.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "bounded",
    storage: {
      kind: "config",
      section: "security",
      field: "sessionIdleTimeoutMinutes",
    },
    description: "Idle window, in minutes, for a standard principal (D-173).",
    bounds: {
      min: SESSION_IDLE_TIMEOUT_MINUTES.min,
      max: SESSION_IDLE_TIMEOUT_MINUTES.max,
    },
  },
  {
    key: "security.sessionIdleTimeoutMinutesElevated",
    category: "Security",
    type: "number",
    schema: z
      .number()
      .int()
      .min(SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.min)
      .max(SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.max),
    default: SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "bounded",
    storage: {
      kind: "config",
      section: "security",
      field: "sessionIdleTimeoutMinutesElevated",
    },
    description:
      "Idle window, in minutes, for a principal holding any high-risk permission (D-173).",
    bounds: {
      min: SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.min,
      max: SESSION_ELEVATED_IDLE_TIMEOUT_MINUTES.max,
    },
  },
  {
    key: "security.allowPrivateNetworkEgress",
    category: "Security",
    type: "boolean",
    schema: z.boolean(),
    default: false,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: {
      kind: "config",
      section: "security",
      field: "allowPrivateNetworkEgress",
    },
    description:
      "Allow an admin-configured destination (OIDC discovery, SMTP test-send) to resolve to a private/loopback address (D-142). Off by default; every change is audited.",
  },

  // --------------------------------------------------------------------- Privacy
  {
    key: "privacy.ageOfDigitalConsentYears",
    category: "Privacy",
    type: "number",
    schema: z
      .number()
      .int()
      .min(AGE_OF_DIGITAL_CONSENT_YEARS.min)
      .max(AGE_OF_DIGITAL_CONSENT_YEARS.max),
    default: AGE_OF_DIGITAL_CONSENT_YEARS.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "bounded",
    storage: {
      kind: "config",
      section: "privacy",
      field: "ageOfDigitalConsentYears",
    },
    description:
      "Age at which a person consents for themselves; guardian authority lapses at this age (D-151).",
    bounds: {
      min: AGE_OF_DIGITAL_CONSENT_YEARS.min,
      max: AGE_OF_DIGITAL_CONSENT_YEARS.max,
    },
  },

  // ------------------------------------------------------------------ Appearance
  {
    key: "appearance.defaultLocale",
    category: "Appearance",
    type: "enum",
    schema: z.enum(locales).nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: {
      kind: "config",
      section: "localization",
      field: "defaultLocale",
    },
    description: "Default locale for visitors with no explicit locale cookie.",
  },
  {
    key: "appearance.dateFormat",
    category: "Appearance",
    type: "enum",
    schema: z.enum(DATE_FORMATS),
    default: "medium",
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "localization", field: "dateFormat" },
    description: "Presentation style for dates and times.",
  },

  // --------------------------------------------------------------------- Website
  {
    key: "website.maintenanceEnabled",
    category: "Website",
    type: "boolean",
    schema: z.boolean(),
    default: false,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "maintenance", field: "enabled" },
    description:
      "Show ordinary visitors a maintenance page instead of the app. Administrators always bypass it.",
  },
  {
    key: "website.maintenanceMessage",
    category: "Website",
    type: "string",
    schema: z
      .string()
      .trim()
      .max(CONFIG_TEXT_MAX.maintenanceMessage)
      .nullable(),
    default: null,
    scope: "instance-wide",
    appliesLive: true,
    permission: MANAGE,
    sensitive: false,
    class: "free",
    storage: { kind: "config", section: "maintenance", field: "message" },
    description:
      "Administrator-authored maintenance-mode message. Plain text only.",
  },

  // ----------------------------------------------------------------- Maintenance
  {
    key: "maintenance.backupPremigrationEnabled",
    category: "Maintenance",
    type: "boolean",
    schema: z.boolean(),
    default: true,
    scope: "instance-wide",
    appliesLive: true,
    permission: "backup.settings.manage",
    sensitive: false,
    class: "free",
    storage: {
      kind: "config",
      section: "backup",
      field: "premigrationEnabled",
    },
    description:
      "Take an automatic backup before applying migrations at start (D-044). Documented against disabling, but not forced.",
  },
  {
    key: "maintenance.backupRetentionDays",
    category: "Maintenance",
    type: "number",
    schema: z.number().int().min(BACKUP_RETENTION_DAYS.min),
    default: BACKUP_RETENTION_DAYS.default,
    scope: "instance-wide",
    appliesLive: true,
    permission: "backup.settings.manage",
    sensitive: false,
    // `free`, not `bounded` (D-171): a documented reason may exceed the
    // shortest special-category retention period; the diagnostics page warns
    // rather than the schema refusing.
    class: "free",
    storage: { kind: "config", section: "backup", field: "retentionDays" },
    description:
      "How long backups are retained, in days. A documented reason may exceed the shortest special-category retention period — see the diagnostics page.",
  },
] as const;

/** The registry keyed by its own `key` — the shape a lookup actually wants. */
export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS_REGISTRY.map((entry) => [entry.key, entry]),
);

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_BY_KEY.get(key);
}

/** Categories the registry actually uses, in §3.2's stated order. */
export function categoriesInUse(): SettingCategory[] {
  const seen = new Set<SettingCategory>();
  const ordered: SettingCategory[] = [];
  for (const entry of SETTINGS_REGISTRY) {
    if (!seen.has(entry.category)) {
      seen.add(entry.category);
      ordered.push(entry.category);
    }
  }
  return ordered;
}
