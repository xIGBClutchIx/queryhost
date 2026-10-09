/** Stable failures produced by the Eco web-server status endpoint. */

import type { QueryErrorCode } from "../../contracts/shared.js";

export type EcoProtocolErrorCode = Extract<
  QueryErrorCode,
  "CONNECTION_FAILED" | "MALFORMED_RESPONSE"
>;

const MESSAGES: Readonly<Record<EcoProtocolErrorCode, string>> = {
  CONNECTION_FAILED: "The Eco web server did not return its status page.",
  MALFORMED_RESPONSE: "The Eco status response was malformed.",
};

/** Protocol error that can be mapped without exposing parser implementation details. */
export class EcoProtocolError extends Error {
  public override readonly name = "EcoProtocolError";
  public readonly code: EcoProtocolErrorCode;

  public constructor(code: EcoProtocolErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

export function failEco(code: EcoProtocolErrorCode): never {
  throw new EcoProtocolError(code);
}
