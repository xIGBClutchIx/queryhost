/** Stable internal failures produced while encoding or parsing the A2S protocol. */

export type A2sProtocolErrorCode =
  "CHALLENGE_LIMIT" | "INVALID_INPUT" | "MALFORMED_RESPONSE" | "SPLIT_PACKET";

const ERROR_MESSAGES: Readonly<Record<A2sProtocolErrorCode, string>> = {
  CHALLENGE_LIMIT: "The A2S server requested too many challenges.",
  INVALID_INPUT: "The A2S protocol input is invalid.",
  MALFORMED_RESPONSE: "The A2S response was malformed.",
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
