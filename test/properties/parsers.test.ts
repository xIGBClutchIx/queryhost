import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { A2sProtocolError } from "../../src/protocols/a2s/errors.js";
import { parseA2sInfoPacket } from "../../src/protocols/a2s/info.js";
import { parseA2sPlayerPacket } from "../../src/protocols/a2s/player.js";
import { parseA2sRulesPacket } from "../../src/protocols/a2s/rules.js";
import { isA2sResponseComplete, reconstructA2sResponse } from "../../src/protocols/a2s/split.js";
import {
  CfxEndpointError,
  parseCfxDynamic,
  parseCfxInfo,
  parseCfxPlayers,
} from "../../src/protocols/cfx/query.js";
import { FIVEM_ENDPOINTS } from "../../src/profiles/fivem.js";
import { MinecraftBedrockProtocolError } from "../../src/protocols/minecraft-bedrock/errors.js";
import { parseMinecraftBedrockPong } from "../../src/protocols/minecraft-bedrock/ping.js";
import { MinecraftJavaProtocolError } from "../../src/protocols/minecraft-java/errors.js";
import {
  parseMinecraftQueryChallenge,
  parseMinecraftQueryStat,
} from "../../src/protocols/minecraft-java/query.js";
import { parseMinecraftStatusResponse } from "../../src/protocols/minecraft-java/status.js";
import { SatisfactoryProtocolError } from "../../src/protocols/satisfactory/errors.js";
import { parseSatisfactoryState } from "../../src/protocols/satisfactory/lightweight.js";
import { parseSatisfactoryHealth } from "../../src/protocols/satisfactory/query.js";
import { EcoProtocolError } from "../../src/protocols/eco/errors.js";
import { parseEcoFrontpage } from "../../src/protocols/eco/frontpage.js";
import { VintageStoryProtocolError } from "../../src/protocols/vintage-story/errors.js";
import { parseVintageStoryQueryResponse } from "../../src/protocols/vintage-story/query.js";
import { ProjectReclaimerProtocolError } from "../../src/protocols/project-reclaimer/errors.js";
import { parseProjectReclaimerStatusResponse } from "../../src/protocols/project-reclaimer/status.js";
import { QuicClientConnection } from "../../src/transports/quic/connection.js";
import { QuicTransportError } from "../../src/transports/quic/errors.js";
import { parseFrames } from "../../src/transports/quic/frames.js";
import { splitDatagram } from "../../src/transports/quic/packet.js";
import { readHandshakeMessages } from "../../src/transports/quic/tls.js";
import { parsePeerTransportParameters } from "../../src/transports/quic/transport-parameters.js";

/**
 * Reads a non-negative integer override. The default suite is fixed and reproducible; the
 * scheduled workflow sets QUERYHOST_PROPERTY_SEED and QUERYHOST_PROPERTY_RUNS to explore further,
 * and fast-check reports the seed of any failure so it can be replayed locally.
 */
function integerFromEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

const PROPERTY_RUNS = Math.max(1, integerFromEnvironment("QUERYHOST_PROPERTY_RUNS", 300));
const PROPERTY_OPTIONS = Object.freeze({
  numRuns: PROPERTY_RUNS,
  seed: integerFromEnvironment("QUERYHOST_PROPERTY_SEED", 0x51_14_2026),
});
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
      { ...PROPERTY_OPTIONS, numRuns: Math.max(1, Math.floor(PROPERTY_RUNS / 2)) },
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

  it("reduces arbitrary Cfx bodies to stable endpoint errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        for (const parse of [parseCfxInfo, parseCfxDynamic, parseCfxPlayers]) {
          acceptsOnlyStableFailure((): void => {
            parse(data, FIVEM_ENDPOINTS);
          }, CfxEndpointError);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary Satisfactory packets to stable protocol errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        for (const parse of [
          (packet: Uint8Array) => parseSatisfactoryState(packet, 0n),
          parseSatisfactoryHealth,
        ]) {
          acceptsOnlyStableFailure((): void => {
            parse(data);
          }, SatisfactoryProtocolError);
        }
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary Vintage Story frames to stable protocol errors", (): void => {
    fc.assert(
      fc.property(bytes, (data): void => {
        acceptsOnlyStableFailure((): void => {
          parseVintageStoryQueryResponse(data);
        }, VintageStoryProtocolError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary Eco status pages to stable protocol errors", (): void => {
    fc.assert(
      fc.property(
        fc.oneof(
          bytes,
          fc.json().map((json) => new TextEncoder().encode(json)),
        ),
        (data): void => {
          acceptsOnlyStableFailure((): void => {
            parseEcoFrontpage(data);
          }, EcoProtocolError);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary Project Reclaimer frames to stable protocol errors", (): void => {
    const framed = (body: Uint8Array): Uint8Array => {
      const frame = new Uint8Array(4 + body.byteLength);
      new DataView(frame.buffer).setUint32(0, body.byteLength);
      frame.set(body, 4);
      return frame;
    };
    const statusLike = fc
      .record(
        {
          name: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
          players: fc.oneof(fc.integer(), fc.double(), fc.string()),
          player_names: fc.array(fc.oneof(fc.string(), fc.integer())),
          mods: fc.array(
            fc.dictionary(fc.constantFrom("id", "title", "maps", "size"), fc.jsonValue()),
          ),
          odst: fc.jsonValue(),
        },
        { requiredKeys: [] },
      )
      .map((value) => new TextEncoder().encode(JSON.stringify(value)));
    fc.assert(
      fc.property(
        fc.oneof(
          bytes,
          fc.json().map((json) => framed(new TextEncoder().encode(json))),
          statusLike.map(framed),
        ),
        (data): void => {
          acceptsOnlyStableFailure((): void => {
            parseProjectReclaimerStatusResponse(data);
          }, ProjectReclaimerProtocolError);
        },
      ),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary QUIC frames to stable transport errors", (): void => {
    fc.assert(
      fc.property(bytes, fc.constantFrom("initial", "handshake", "application"), (data, space) => {
        acceptsOnlyStableFailure((): void => {
          parseFrames(data, space);
        }, QuicTransportError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary QUIC datagrams to packets or stable transport errors", (): void => {
    fc.assert(
      fc.property(bytes, fc.integer({ min: 0, max: 20 }), (data, localIdLength): void => {
        acceptsOnlyStableFailure((): void => {
          splitDatagram(data, localIdLength);
        }, QuicTransportError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary TLS handshake bytes to messages or stable transport errors", (): void => {
    // A plausible header (type, 24-bit length) reaches the bounds checks random bytes rarely do.
    const messageLike = fc
      .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 40_000 }), bytes)
      .map(
        ([type, length, body]) =>
          new Uint8Array([
            type,
            (length >> 16) & 0xff,
            (length >> 8) & 0xff,
            length & 0xff,
            ...body,
          ]),
      );
    fc.assert(
      fc.property(fc.oneof(bytes, messageLike), (data): void => {
        acceptsOnlyStableFailure((): void => {
          readHandshakeMessages(data);
        }, QuicTransportError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("reduces arbitrary QUIC transport parameters to values or stable transport errors", (): void => {
    const ids = {
      originalDestination: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
      initialSource: Uint8Array.of(9, 9, 9, 9),
      retrySource: undefined,
    };
    // Well-formed id/length/value records reach the per-parameter validation.
    const parameter = fc
      .tuple(fc.integer({ min: 0, max: 0x20 }), fc.uint8Array({ maxLength: 20 }))
      .map(([id, value]) => new Uint8Array([id, value.byteLength, ...value]));
    const parameters = fc
      .array(fc.oneof(parameter, fc.uint8Array({ maxLength: 8 })), { maxLength: 24 })
      .map((records) => Uint8Array.from(records.flatMap((record) => [...record])));
    fc.assert(
      fc.property(fc.oneof(bytes, parameters), (data): void => {
        acceptsOnlyStableFailure((): void => {
          parsePeerTransportParameters(data, ids);
        }, QuicTransportError);
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("keeps a QUIC connection to dropped packets or stable errors on arbitrary datagrams", (): void => {
    // Long headers for version 1 reach header, Retry, and coalescing paths that random bytes rarely do.
    const longHeader = fc
      .tuple(
        fc.integer({ min: 0xc0, max: 0xff }),
        fc.uint8Array({ maxLength: 20 }),
        fc.uint8Array({ maxLength: 20 }),
        fc.uint8Array({ maxLength: 1_400 }),
      )
      .map(
        ([first, destination, source, rest]) =>
          new Uint8Array([
            first,
            0,
            0,
            0,
            1,
            destination.byteLength,
            ...destination,
            source.byteLength,
            ...source,
            ...rest,
          ]),
      );
    let seed = 0;
    fc.assert(
      fc.property(fc.array(fc.oneof(bytes, longHeader), { maxLength: 6 }), (incoming): void => {
        const connection = new QuicClientConnection({
          serverName: "reclaimer",
          alpn: [],
          request: Uint8Array.of(1),
          maxResponseBytes: 1_024,
          inspectResponse: () => "incomplete",
          randomBytes: (length) => new Uint8Array(length).map(() => (seed = (seed * 31 + 7) % 251)),
        });
        connection.start();
        acceptsOnlyStableFailure((): void => {
          for (const datagram of incoming) {
            connection.receive(datagram);
          }
          connection.probe();
        }, QuicTransportError);
        expect(connection.response).toBeUndefined();
      }),
      PROPERTY_OPTIONS,
    );
  });
});
