/** Stable failures produced by the QUIC transport and its handshake. */

import type { QueryErrorCode } from "../../contracts/shared.js";

/** QUIC failures that map directly into the stable public query contract. */
export type QuicTransportErrorCode = Extract<
  QueryErrorCode,
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
>;

const ERROR_MESSAGES: Readonly<Record<QuicTransportErrorCode, string>> = {
  ABORTED: "The QUIC exchange was cancelled.",
  CONNECTION_FAILED: "The QUIC exchange could not be completed.",
  INVALID_INPUT: "The QUIC exchange input is invalid.",
  MALFORMED_RESPONSE: "The QUIC response was malformed.",
  RESPONSE_TOO_LARGE: "The QUIC response exceeded its size limit.",
  TIMEOUT: "The QUIC exchange timed out.",
} as const;

/** Stable transport error that never exposes socket, TLS, or packet implementation details. */
export class QuicTransportError extends Error {
  public override readonly name = "QuicTransportError";
  public readonly code: QuicTransportErrorCode;

  public constructor(code: QuicTransportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

export function failQuic(code: QuicTransportErrorCode): never {
  throw new QuicTransportError(code);
}
