/**
 * `fees` module public API — billing-lite (R-32, `15-assessment-and-fees.md`
 * §6; D-088, D-090, D-091, D-092).
 *
 * It owns `FeeType`, `Charge`, `Payment`. No other module reads those tables
 * directly; it calls one of these services (D-057, `CLAUDE.md` §4).
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 *   - The repositories. A caller reaching `listChargesForPayer` directly
 *     would have to supply its own authorization, and the point of the
 *     service layer is that the guard and the query are never separable.
 *   - Anything that deletes a `Charge` or a `Payment`. Neither table has a
 *     delete path in this module — `waiveCharge`/`cancelCharge` are the only
 *     mutations, and both are additive facts recorded on the row, never a
 *     row's removal (`CLAUDE.md` rule 4).
 *
 * WHAT THIS PHASE DELIBERATELY DOES NOT WIRE, AND WHY — see
 * `docs/build/phase-3.3-fees-report.md` §1:
 *   - D-089's automatic exam-fee charge (`ExamCandidate -> CONFIRMED`
 *     creates a `Charge`) — would require editing `exams`, outside this
 *     phase's write scope.
 *   - §6.2's scheduled periodic-membership-billing job — no `maintenance`
 *     job runner exists yet in this codebase to hang it on.
 *   Both are satisfied MANUALLY today: an administrator may create a
 *   `Charge` of any `FeeType` for any payer/student pair through
 *   `createCharge`, which is what R-32's own "Required product behavior"
 *   asks for.
 */

export {
  createFeeType,
  updateFeeType,
  listFeeTypesForPrincipal,
  getFeeTypeForPrincipal,
  FeeTypeError,
  type ActorContext,
  type CreateFeeTypeInput,
  type UpdateFeeTypeInput,
  type FeeTypeView,
} from "./application/fee-type-service";

export {
  createCharge,
  waiveCharge,
  cancelCharge,
  ChargeError,
  type CreateChargeInput,
  type WaiveChargeInput,
  type CancelChargeInput,
} from "./application/charge-service";

export {
  recordPayment,
  PaymentError,
  type RecordPaymentInput,
} from "./application/payment-service";

export {
  getFeeBalanceForPayer,
  getFeeBalanceForStudent,
  type FeeBalanceView,
  type ChargeWithBalance,
} from "./application/balance-service";

export { exportFeesCsv } from "./application/export-service";

export {
  deriveChargeBalance,
  runningBalance,
  type ChargeBalance,
  type DerivedChargeState,
} from "./domain/balance";

export {
  formatMinorUnitsAsDecimalString,
  parseEurosToMinorUnits,
} from "./domain/money";
