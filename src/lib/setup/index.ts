/**
 * First-run setup: the wizard's gate, its one-time token and its cookie
 * (`13-configuration-and-setup.md` §6.3, D-039/D-101/D-187).
 *
 * Import from here (`@/lib/setup`) rather than from the files behind it — with
 * ONE deliberate exception: `@/lib/boot/setup-mode.ts` imports `./token`
 * directly, because a barrel that re-exports `./gate` would make
 * `boot → setup → boot` a cycle. That is the only reason and it is stated so
 * nobody "tidies" it.
 */

export { dataDir, dataPath, type SetupEnv } from "./data-dir";

export {
  SETUP_TOKEN_FILENAME,
  SETUP_TOKEN_TTL_MINUTES,
  SETUP_TOKEN_USED_FILENAME,
  clearSetupToken,
  consumeSetupToken,
  ensureSetupToken,
  hasUsableSetupToken,
  issueSetupToken,
  normaliseSetupToken,
  readSetupToken,
  setupTokenFileExists,
  setupTokenPath,
  setupTokenStatus,
  usedSetupTokenPath,
  type SetupTokenRecord,
  type SetupTokenRefusal,
  type SetupTokenStatus,
  type SetupTokenVerdict,
} from "./token";

export {
  LOCKOUT_MS,
  MAX_ATTEMPTS,
  WINDOW_MS,
  checkSetupAttempt,
  clearSetupAttempts,
  recordSetupAttemptFailure,
  resetSetupAttempts,
  type AttemptDecision,
} from "./attempts";

export {
  WIZARD_COOKIE,
  WIZARD_SESSION_TTL_MINUTES,
  endWizardSession,
  hasWizardSession,
  mintWizardSession,
  startWizardSession,
  verifyWizardSession,
} from "./wizard-session";

export {
  decideWizardAccess,
  resolveWizardAccess,
  type WizardAccessInput,
  type WizardStage,
} from "./gate";
