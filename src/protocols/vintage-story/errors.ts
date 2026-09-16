/** Stable failures produced by Vintage Story packet encoding and parsing. */

import type { QueryErrorCode } from "../../contracts/shared.js";

export type VintageStoryProtocolErrorCode = Extract<
  QueryErrorCode,
  "INVALID_INPUT" | "MALFORMED_RESPONSE" | "RESPONSE_TOO_LARGE"
>;

const MESSAGES: Readonly<Record<VintageStoryProtocolErrorCode, string>> = {
  INVALID_INPUT: "The Vintage Story query input is invalid.",
  MALFORMED_RESPONSE: "The Vintage Story query response was malformed.",
  RESPONSE_TOO_LARGE: "The Vintage Story query response exceeded its size limit.",
};

/** Protocol error that can be mapped without exposing parser implementation details. */
export class VintageStoryProtocolError extends Error {
  public override readonly name = "VintageStoryProtocolError";
  public readonly code: VintageStoryProtocolErrorCode;

  public constructor(code: VintageStoryProtocolErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

export function failVintageStory(code: VintageStoryProtocolErrorCode): never {
  throw new VintageStoryProtocolError(code);
}
