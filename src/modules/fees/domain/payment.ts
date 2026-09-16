export type PaymentRefusal = "CHARGE_NOT_FOUND";

export class PaymentError extends Error {
  constructor(public readonly reason: PaymentRefusal) {
    super(PAYMENT_MESSAGES[reason]);
    this.name = "PaymentError";
  }
}

const PAYMENT_MESSAGES: Record<PaymentRefusal, string> = {
  CHARGE_NOT_FOUND:
    "This charge does not exist, or was removed before the request completed.",
};
