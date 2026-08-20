/** Stable internal failures produced while encoding or parsing the A2S protocol. */

export type A2sProtocolErrorCode =
  | "CHALLENGE_LIMIT"
  | "CHECKSUM_MISMATCH"
  | "DECOMPRESSION_FAILED"
  | "FRAGMENT_CONFLICT"
  | "FRAGMENT_LIMIT"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "MISSING_FRAGMENT"
  | "RESPONSE_TOO_LARGE"
  | "SPLIT_PACKET";

const ERROR_MESSAGES: Readonly<Record<A2sProtocolErrorCode, string>> = {
  CHALLENGE_LIMIT: "The A2S server requested too many challenges.",
  CHECKSUM_MISMATCH: "The reconstructed A2S response checksum did not match.",
  DECOMPRESSION_FAILED: "The compressed A2S response could not be decoded safely.",
  FRAGMENT_CONFLICT: "The A2S response contained conflicting fragments.",
  FRAGMENT_LIMIT: "The A2S response exceeded its fragment limit.",
  INVALID_INPUT: "The A2S protocol input is invalid.",
  MALFORMED_RESPONSE: "The A2S response was malformed.",
  MISSING_FRAGMENT: "The A2S response was missing one or more fragments.",
  RESPONSE_TOO_LARGE: "The reconstructed A2S response exceeded its size limit.",
  SPLIT_PACKET: "The A2S response uses split packets.",
} as const;

/** Protocol error with a stable code and no untrusted packet contents. */
export class A2sProtocolError extends Error {
  public override readonly name = "A2sProtocolError";
  public readonly code: A2sProtocolErrorCode;

  public constructor(code: A2sProtocolErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Throws a stable A2S protocol error. */
export function failA2s(code: A2sProtocolErrorCode): never {
  throw new A2sProtocolError(code);
}
