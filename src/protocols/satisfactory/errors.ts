import type { QueryErrorCode } from "../../contracts/shared.js";

export type SatisfactoryProtocolErrorCode = Extract<
  QueryErrorCode,
  "INVALID_INPUT" | "MALFORMED_RESPONSE" | "RESPONSE_TOO_LARGE"
>;

/** Stable parser failure for Satisfactory protocol data. */
export class SatisfactoryProtocolError extends Error {
  public override readonly name = "SatisfactoryProtocolError";
  public readonly code: SatisfactoryProtocolErrorCode;

  public constructor(code: SatisfactoryProtocolErrorCode) {
    super("The Satisfactory protocol data was invalid.");
    this.code = code;
  }
}

export function failSatisfactory(code: SatisfactoryProtocolErrorCode): never {
  throw new SatisfactoryProtocolError(code);
}
