/** Stable failures produced while encoding or parsing Minecraft Java status traffic. */

export type MinecraftJavaProtocolErrorCode =
  "INVALID_INPUT" | "MALFORMED_RESPONSE" | "RESPONSE_TOO_LARGE";

const ERROR_MESSAGES: Readonly<Record<MinecraftJavaProtocolErrorCode, string>> = {
  INVALID_INPUT: "The Minecraft Java protocol input is invalid.",
  MALFORMED_RESPONSE: "The Minecraft Java status response was malformed.",
  RESPONSE_TOO_LARGE: "The Minecraft Java status response exceeded its size limit.",
} as const;

/** Protocol error with a stable code and no untrusted response content. */
export class MinecraftJavaProtocolError extends Error {
  public override readonly name = "MinecraftJavaProtocolError";
  public readonly code: MinecraftJavaProtocolErrorCode;

  public constructor(code: MinecraftJavaProtocolErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Throws one stable Minecraft Java protocol error. */
export function failMinecraftJava(code: MinecraftJavaProtocolErrorCode): never {
  throw new MinecraftJavaProtocolError(code);
}
