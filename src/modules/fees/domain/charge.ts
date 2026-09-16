export type ChargeRefusal =
  | "FEE_TYPE_NOT_FOUND"
  | "FEE_TYPE_INACTIVE"
  | "PAYER_NOT_FOUND"
  | "STUDENT_NOT_FOUND"
  | "CHARGE_NOT_FOUND"
  | "ALREADY_WAIVED"
  | "ALREADY_CANCELLED";

export class ChargeError extends Error {
  constructor(public readonly reason: ChargeRefusal) {
    super(CHARGE_MESSAGES[reason]);
    this.name = "ChargeError";
  }
}

const CHARGE_MESSAGES: Record<ChargeRefusal, string> = {
  FEE_TYPE_NOT_FOUND: "This fee type does not exist.",
  FEE_TYPE_INACTIVE:
    "This fee type is no longer active. Reactivate it, or choose a current " +
    "one — a charge always copies the amount and currency of an ACTIVE fee " +
    "type at the moment it is created.",
  PAYER_NOT_FOUND: "This payer does not exist.",
  STUDENT_NOT_FOUND: "This student does not exist.",
  CHARGE_NOT_FOUND:
    "This charge does not exist, or was removed before the request completed.",
  ALREADY_WAIVED: "This charge has already been waived.",
  ALREADY_CANCELLED: "This charge has already been cancelled.",
};
