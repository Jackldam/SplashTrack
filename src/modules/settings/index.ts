/**
 * Settings module public API (R-17/R-21).
 *
 * The typed registry (§3.2), the D-141 lockout invariant, the read/write
 * service, and the diagnostics report. See each file's own header for detail.
 */

export {
  SETTINGS_REGISTRY,
  SETTINGS_BY_KEY,
  SETTING_CATEGORIES,
  SETTING_CLASSES,
  settingDefinition,
  categoriesInUse,
  type SettingDefinition,
  type SettingCategory,
  type SettingClass,
  type SettingType,
  type SettingStorage,
} from "./domain/registry";

export {
  lockoutInvariantHolds,
  checkLockoutInvariant,
  type LockoutInvariantCounts,
  type LockoutInvariantCheck,
} from "./domain/lockout-invariant";

export {
  countQualifyingAccounts,
  evaluateLockoutInvariant,
  assertLockoutInvariantHolds,
  LockoutInvariantViolationError,
  type LockoutInvariantExclusions,
} from "./application/lockout-invariant-service";

export {
  getEffectiveSettings,
  updateSetting,
  readSecretPlaintext,
  type EffectiveSetting,
  type UpdateSettingInput,
} from "./application/settings-service";

export {
  buildDiagnosticsReport,
  type DiagnosticsReport,
} from "./application/diagnostics-service";
