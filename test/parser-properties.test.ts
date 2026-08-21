import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { A2sProtocolError } from "../src/protocols/a2s/errors.js";
import { parseA2sInfoPacket } from "../src/protocols/a2s/info.js";
import { parseA2sPlayerPacket } from "../src/protocols/a2s/player.js";
import { parseA2sRulesPacket } from "../src/protocols/a2s/rules.js";
import { isA2sResponseComplete, reconstructA2sResponse } from "../src/protocols/a2s/split.js";
import {
  FiveMEndpointError,
  parseFiveMDynamic,
  parseFiveMInfo,
  parseFiveMPlayers,
} from "../src/protocols/fivem/query.js";
import { MinecraftBedrockProtocolError } from "../src/protocols/minecraft-bedrock/errors.js";
import { parseMinecraftBedrockPong } from "../src/protocols/minecraft-bedrock/ping.js";
import { MinecraftJavaProtocolError } from "../src/protocols/minecraft-java/errors.js";
import {
  parseMinecraftQueryChallenge,
  parseMinecraftQueryStat,
} from "../src/protocols/minecraft-java/query.js";
import { parseMinecraftStatusResponse } from "../src/protocols/minecraft-java/status.js";

const PROPERTY_OPTIONS = Object.freeze({ numRuns: 300, seed: 0x51_14_2026 });
const bytes = fc.uint8Array({ maxLength: 4_096 });
const datagrams = fc.array(fc.uint8Array({ maxLength: 512 }), { maxLength: 8 });

function acceptsOnlyStableFailure(
  work: () => void,
  errorType: new (...values: never[]) => Error,
): void {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(errorType);
  }
}

async function acceptsOnlyStableAsyncFailure(
  work: () => Promise<void>,
  errorType: new (...values: never[]) => Error,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(errorType);
  }
}

describe("bounded parser properties", (): void => {
  it("reduces arbitrary A2S packets to a value or stable protocol error", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        for (const parse of [parseA2sInfoPacket, parseA2sPlayerPacket, parseA2sRulesPacket]) {
          acceptsOnlyStableFailure((): void => {
            parse(data);
          }, A2sProtocolError);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("bounds arbitrary A2S fragment collections", async (): Promise<void> => {
    await fc.assert(
      fc.asyncProperty(datagrams, async (packets): Promise<void> => {
        acceptsOnlyStableFailure((): void => {
          isA2sResponseComplete(packets);
        }, A2sProtocolError);
        await acceptsOnlyStableAsyncFailure(async (): Promise<void> => {
          await reconstructA2sResponse(packets);
        }, A2sProtocolError);
      }),
      { ...PROPERTY_OPTIONS, numRuns: 150 },
    );
  });

  it("reduces arbitrary Minecraft Java packets to stable errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        for (const parse of [
          parseMinecraftStatusResponse,
          (packet: Uint8Array) => parseMinecraftQueryChallenge(packet, 0),
          (packet: Uint8Array) => parseMinecraftQueryStat(packet, 0),
        ]) {
          acceptsOnlyStableFailure((): void => {
            parse(data);
          }, MinecraftJavaProtocolError);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary Minecraft Bedrock packets to stable errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        acceptsOnlyStableFailure((): void => {
          parseMinecraftBedrockPong(data, 0n);
        }, MinecraftBedrockProtocolError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary FiveM bodies to stable endpoint errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        for (const parse of [parseFiveMInfo, parseFiveMDynamic, parseFiveMPlayers]) {
          acceptsOnlyStableFailure((): void => {
            parse(data);
          }, FiveMEndpointError);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });
});
