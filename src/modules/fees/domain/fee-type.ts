/** A refusal a person caused and can act on, as opposed to a bug — the
 * `FacilityError`/`CourseLevelError` shape. */
export type FeeTypeRefusal = "DUPLICATE_CODE" | "FEE_TYPE_NOT_FOUND";

export class FeeTypeError extends Error {
  constructor(public readonly reason: FeeTypeRefusal) {
    super(FEE_TYPE_MESSAGES[reason]);
    this.name = "FeeTypeError";
  }
}

const FEE_TYPE_MESSAGES: Record<FeeTypeRefusal, string> = {
  DUPLICATE_CODE:
    "A fee type with this code already exists. Codes are the club's own " +
    "short identifiers and must be unique; correct the spelling of the one " +
    "already there instead of creating a second entry for the same fee.",
  FEE_TYPE_NOT_FOUND:
    "This fee type does not exist, or was removed from the reference before " +
    "the request completed.",
};
