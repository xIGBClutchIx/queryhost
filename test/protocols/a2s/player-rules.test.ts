import { describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../../src/network/target.js";
import { A2sProtocolError } from "../../../src/protocols/a2s/errors.js";
import {
  encodeA2sPlayerRequest,
  parseA2sPlayerPacket,
  queryA2sPlayer,
} from "../../../src/protocols/a2s/player.js";
import {
  encodeA2sRulesRequest,
  parseA2sRulesPacket,
  queryA2sRules,
} from "../../../src/protocols/a2s/rules.js";
import { createExecutionContext } from "../../../src/runtime/execution.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../../../src/transports/udp.js";

const ADDRESS: PinnedAddress = Object.freeze({ address: "127.0.0.1", family: 4 });
const HEADER = Uint8Array.of(0xff, 0xff, 0xff, 0xff);

function target(port = 27_015): PinnedTarget {
  return Object.freeze({ hostname: ADDRESS.address, port, addresses: Object.freeze([ADDRESS]) });
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function string(value: string): Uint8Array {
  return join([new TextEncoder().encode(value), Uint8Array.of(0)]);
}

function int32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setInt32(0, value, true);
  return output;
}

function float32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setFloat32(0, value, true);
  return output;
}

function challenge(value = 0x1234_5678): Uint8Array {
  return join([HEADER, Uint8Array.of(0x41), int32(value)]);
}

function playerResponse(): Uint8Array {
  return join([
    HEADER,
    Uint8Array.of(0x44, 2, 0),
    string("Ada"),
    int32(42),
    float32(12.5),
    Uint8Array.of(3),
    string(""),
    int32(-7),
    float32(0),
  ]);
}

function rulesResponse(): Uint8Array {
  return join([
    HEADER,
    Uint8Array.of(0x45, 3, 0),
    string("hostname"),
    string("QueryHost"),
    string("empty"),
    string(""),
    string("__proto__"),
    string("safe"),
  ]);
}

function responses(...packets: readonly Uint8Array[]): {
  readonly collect: (options: UdpCollectionOptions) => Promise<UdpCollectionResult>;
} {
  let index = 0;
  return {
    collect(options: UdpCollectionOptions): Promise<UdpCollectionResult> {
      const packet = packets[index];
      index += 1;
      if (packet === undefined) {
        throw new Error("No test response remains.");
      }
      return Promise.resolve({
        datagrams: Object.freeze([packet]),
        rttMs: index * 2,
        address: options.address,
        port: options.target.port,
      });
    },
  };
}

function expectMalformed(action: () => void): void {
  expect(action).toThrow(A2sProtocolError);
  try {
    action();
  } catch (error) {
    if (error instanceof A2sProtocolError) {
      expect(error.code).toBe("MALFORMED_RESPONSE");
      return;
    }
  }
  throw new Error("Expected a malformed A2S packet.");
}

describe("A2S Player", (): void => {
  it("encodes initial and challenged requests exactly", (): void => {
    expect([...encodeA2sPlayerRequest()]).toEqual([255, 255, 255, 255, 0x55, 255, 255, 255, 255]);
    expect([...encodeA2sPlayerRequest(0x1234_5678).subarray(5)]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("parses confirmed players without inventing values", (): void => {
    const packet = parseA2sPlayerPacket(playerResponse());
    expect(packet).toEqual({
      kind: "data",
      value: [
        { index: 0, name: "Ada", score: 42, durationSeconds: 12.5 },
        { index: 3, name: "", score: -7, durationSeconds: 0 },
      ],
    });
    expect(packet.kind === "data" && Object.isFrozen(packet.value)).toBe(true);
  });

  it("distinguishes a challenge and a confirmed empty list", (): void => {
    expect(parseA2sPlayerPacket(challenge())).toEqual({
      kind: "challenge",
      challenge: 0x1234_5678,
    });
    expect(parseA2sPlayerPacket(join([HEADER, Uint8Array.of(0x44, 0)]))).toEqual({
      kind: "data",
      value: [],
    });
  });

  it("rejects truncation, trailing bytes, duplicate indexes, and invalid durations", (): void => {
    const valid = playerResponse();
    expectMalformed(() => parseA2sPlayerPacket(valid.subarray(0, valid.byteLength - 1)));
    expectMalformed(() => parseA2sPlayerPacket(join([valid, Uint8Array.of(0)])));
    expectMalformed(() =>
      parseA2sPlayerPacket(
        join([
          HEADER,
          Uint8Array.of(0x44, 2, 1),
          string("A"),
          int32(0),
          float32(1),
          Uint8Array.of(1),
          string("B"),
          int32(0),
          float32(1),
        ]),
      ),
    );
    expectMalformed(() =>
      parseA2sPlayerPacket(
        join([HEADER, Uint8Array.of(0x44, 1, 0), string("A"), int32(0), float32(-1)]),
      ),
    );
    expectMalformed(() =>
      parseA2sPlayerPacket(
        join([HEADER, Uint8Array.of(0x44, 1, 0), string("x".repeat(1_025)), int32(0), float32(1)]),
      ),
    );
  });

  it("performs one challenge retry and adds both exchange durations", async (): Promise<void> => {
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    const result = await queryA2sPlayer(
      { scope, target: target(), address: ADDRESS },
      responses(challenge(), playerResponse()),
    );
    scope.close();

    expect(result.challenged).toBe(true);
    expect(result.rttMs).toBe(6);
    expect(result.players).toHaveLength(2);
  });

  it("rejects a second challenge", async (): Promise<void> => {
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    await expect(
      queryA2sPlayer(
        { scope, target: target(), address: ADDRESS },
        responses(challenge(), challenge()),
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_LIMIT" });
    scope.close();
  });
});

describe("A2S Rules", (): void => {
  it("encodes initial and challenged requests exactly", (): void => {
    expect([...encodeA2sRulesRequest()]).toEqual([255, 255, 255, 255, 0x56, 255, 255, 255, 255]);
    expect([...encodeA2sRulesRequest(0x1234_5678).subarray(5)]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("parses rules, empty values, and special property names safely", (): void => {
    const packet = parseA2sRulesPacket(rulesResponse());
    expect(packet).toMatchObject({
      kind: "data",
      value: { hostname: "QueryHost", empty: "" },
    });
    if (packet.kind !== "data") {
      throw new Error("Expected rule data.");
    }
    expect(Object.getPrototypeOf(packet.value)).toBe(Object.prototype);
    expect(Object.hasOwn(packet.value, "__proto__")).toBe(true);
    expect(packet.value["__proto__"]).toBe("safe");
    expect(Object.isFrozen(packet.value)).toBe(true);
  });

  it("distinguishes a challenge and a confirmed empty rule map", (): void => {
    expect(parseA2sRulesPacket(challenge())).toEqual({ kind: "challenge", challenge: 0x1234_5678 });
    expect(parseA2sRulesPacket(join([HEADER, Uint8Array.of(0x45, 0, 0)]))).toEqual({
      kind: "data",
      value: {},
    });
  });

  it("rejects truncation, trailing bytes, empty names, and duplicate names", (): void => {
    const valid = rulesResponse();
    expectMalformed(() => parseA2sRulesPacket(valid.subarray(0, valid.byteLength - 1)));
    expectMalformed(() => parseA2sRulesPacket(join([valid, Uint8Array.of(0)])));
    expectMalformed(() =>
      parseA2sRulesPacket(join([HEADER, Uint8Array.of(0x45, 1, 0), string(""), string("value")])),
    );
    expectMalformed(() =>
      parseA2sRulesPacket(
        join([
          HEADER,
          Uint8Array.of(0x45, 2, 0),
          string("same"),
          string("one"),
          string("same"),
          string("two"),
        ]),
      ),
    );
    expectMalformed(() =>
      parseA2sRulesPacket(
        join([HEADER, Uint8Array.of(0x45, 1, 16), string("unread"), string("value")]),
      ),
    );
    expectMalformed(() =>
      parseA2sRulesPacket(
        join([HEADER, Uint8Array.of(0x45, 1, 0), string("x".repeat(1_025)), string("value")]),
      ),
    );
  });

  it("performs one challenge retry and adds both exchange durations", async (): Promise<void> => {
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    const result = await queryA2sRules(
      { scope, target: target(), address: ADDRESS },
      responses(challenge(), rulesResponse()),
    );
    scope.close();

    expect(result.challenged).toBe(true);
    expect(result.rttMs).toBe(6);
    expect(result.rules["hostname"]).toBe("QueryHost");
  });

  it("rejects a second challenge", async (): Promise<void> => {
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    await expect(
      queryA2sRules(
        { scope, target: target(), address: ADDRESS },
        responses(challenge(), challenge()),
      ),
    ).rejects.toMatchObject({ code: "CHALLENGE_LIMIT" });
    scope.close();
  });
});
