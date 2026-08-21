/** Stable failures produced while encoding or parsing Minecraft Bedrock RakNet traffic. */

export type MinecraftBedrockProtocolErrorCode =
  "INVALID_INPUT" | "MALFORMED_RESPONSE" | "RESPONSE_TOO_LARGE";

const ERROR_MESSAGES: Readonly<Record<MinecraftBedrockProtocolErrorCode, string>> = {
  INVALID_INPUT: "The Minecraft Bedrock protocol input is invalid.",
  MALFORMED_RESPONSE: "The Minecraft Bedrock response was malformed.",
  RESPONSE_TOO_LARGE: "The Minecraft Bedrock response exceeded its size limit.",
} as const;

/** Protocol error with a stable code and no untrusted response content. */
export class MinecraftBedrockProtocolError extends Error {
  public override readonly name = "MinecraftBedrockProtocolError";
  public readonly code: MinecraftBedrockProtocolErrorCode;

  public constructor(code: MinecraftBedrockProtocolErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Throws one stable Minecraft Bedrock protocol error. */
export function failMinecraftBedrock(code: MinecraftBedrockProtocolErrorCode): never {
  throw new MinecraftBedrockProtocolError(code);
}
