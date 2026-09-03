/**
 * The boot surface: the state machine the entrypoint runs before it decides
 * anything (D-055/D-098/D-099), and the per-request "is setup finished" gate.
 */
export {
  detectBootState,
  imageMigrationNames,
  type BootAction,
  type BootDecision,
  type BootState,
} from "./state";

export {
  INSTALLATION_BOOTSTRAP_ID,
  isSetupIncomplete,
  resetSetupModeLatch,
} from "./setup-mode";
