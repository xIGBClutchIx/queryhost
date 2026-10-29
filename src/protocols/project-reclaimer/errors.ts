/** Stable failures produced by Project Reclaimer status framing and parsing. */

import type { QueryErrorCode } from "../../contracts/shared.js";

export type ProjectReclaimerProtocolErrorCode = Extract<
  QueryErrorCode,
  "MALFORMED_RESPONSE" | "RESPONSE_TOO_LARGE"
>;

const MESSAGES: Readonly<Record<ProjectReclaimerProtocolErrorCode, string>> = {
  MALFORMED_RESPONSE: "The Project Reclaimer status response was malformed.",
  RESPONSE_TOO_LARGE: "The Project Reclaimer status response exceeded its size limit.",
};

/** Protocol error that can be mapped without exposing parser implementation details. */
export class ProjectReclaimerProtocolError extends Error {
  public override readonly name = "ProjectReclaimerProtocolError";
  public readonly code: ProjectReclaimerProtocolErrorCode;

  public constructor(code: ProjectReclaimerProtocolErrorCode) {
    super(MESSAGES[code]);
    this.code = code;
  }
}

export function failProjectReclaimer(code: ProjectReclaimerProtocolErrorCode): never {
  throw new ProjectReclaimerProtocolError(code);
}
