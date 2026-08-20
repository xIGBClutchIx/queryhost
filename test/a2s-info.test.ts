import type { Socket } from "node:dgram";
import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createExecutionContext } from "../src/execution.js";
import { A2sProtocolError } from "../src/protocols/a2s/errors.js";
import {
  A2S_SINGLE_PACKET_MAX_BYTES,
  encodeA2sInfoRequest,
  parseA2sInfoPacket,
  queryA2sInfo,
  type A2sInfoDependencies,
} from "../src/protocols/a2s/info.js";
import type { PinnedAddress, PinnedTarget } from "../src/target.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../src/transports/udp.js";
import { startFakeUdpServer, stopAllFakeUdpServers } from "./helpers/fake-udp-server.js";

const LOOPBACK_ADDRESS: PinnedAddress = Object.freeze({ address: "127.0.0.1", family: 4 });
const BASE_REQUEST = Uint8Array.of(
  0xff,
  0xff,
  0xff,
  0xff,
  0x54,
  ...new TextEncoder().encode("Source Engine Query\0"),
);

function createTarget(port: number): PinnedTarget {
  return Object.freeze({
    hostname: LOOPBACK_ADDRESS.address,
    port,
    addresses: Object.freeze([LOOPBACK_ADDRESS]),
  });
}

function send(server: Socket, data: Uint8Array, port: number, address: string): void {
  server.send(data, port, address);
}

function sourceFragment(
  requestId: number,
  count: number,
  index: number,
  payload: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(12 + payload.byteLength);
  result.set(Uint8Array.of(0xfe, 0xff, 0xff, 0xff));
  const view = new DataView(result.buffer);
  view.setUint32(4, requestId, true);
  result[8] = count;
  result[9] = index;
  view.setUint16(10, 1_248, true);
  result.set(payload, 12);
  return result;
}

/** Wraps chunks from the bzip2-compressed redacted fixture using its fixed size and CRC32. */
function compressedCapturedSourceFragment(
  requestId: number,
  count: number,
  index: number,
  payload: Uint8Array,
): Uint8Array {
  const metadataBytes = index === 0 ? 8 : 0;
  const result = new Uint8Array(12 + metadataBytes + payload.byteLength);
  result.set(Uint8Array.of(0xfe, 0xff, 0xff, 0xff));
  const view = new DataView(result.buffer);
  view.setUint32(4, requestId | 0x8000_0000, true);
  result[8] = count;
  result[9] = index;
  view.setUint16(10, 1_248, true);
  if (index === 0) {
    view.setUint32(12, 103, true);
    view.setUint32(16, 1_982_530_295, true);
  }
  result.set(payload, 12 + metadataBytes);
  return result;
}

async function readHexFixture(name: string): Promise<Uint8Array> {
  const text = await readFile(new URL(`./fixtures/a2s/${name}`, import.meta.url), "utf8");
  const compact = text.replaceAll(/\s/gu, "");
  if (compact.length === 0 || compact.length % 2 !== 0 || /[^0-9a-f]/iu.test(compact)) {
    throw new Error(`Invalid hex fixture: ${name}`);
  }

  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = compact.slice(index * 2, index * 2 + 2);
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}

function expectProtocolCode(code: A2sProtocolError["code"]): (error: Error) => boolean {
  return (error: Error): boolean => error instanceof A2sProtocolError && error.code === code;
}

function expectProtocolFailure(action: () => void, code: A2sProtocolError["code"]): void {
  let failure: Error | undefined;
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      failure = error;
    }
  }

  expect(failure).toBeInstanceOf(A2sProtocolError);
  if (!(failure instanceof A2sProtocolError)) {
    throw new Error("Expected an A2S protocol error.");
  }
  expect(failure.code).toBe(code);
}

afterEach(async (): Promise<void> => {
  await stopAllFakeUdpServers();
});

describe("A2S Info request encoding", (): void => {
  it("encodes the fixed request without a challenge", (): void => {
    expect(encodeA2sInfoRequest()).toEqual(BASE_REQUEST);
  });

  it("appends a signed little-endian challenge", (): void => {
    const request = encodeA2sInfoRequest(0x6c08_816a);

    expect(request.subarray(0, BASE_REQUEST.byteLength)).toEqual(BASE_REQUEST);
    expect([...request.subarray(BASE_REQUEST.byteLength)]).toEqual([0x6a, 0x81, 0x08, 0x6c]);
  });

  it.each([-2_147_483_649, 2_147_483_648, 1.5])(
    "rejects a challenge outside the signed 32-bit contract",
    (challenge): void => {
      expectProtocolFailure(() => encodeA2sInfoRequest(challenge), "INVALID_INPUT");
    },
  );
});

describe("A2S Info parsing", (): void => {
  it("parses the redacted captured Source response and all represented EDF fields", async (): Promise<void> => {
    const packet = parseA2sInfoPacket(await readHexFixture("source-captured-redacted.hex"));

    expect(packet).toEqual({
      kind: "info",
      info: {
        format: "source",
        protocol: 17,
        name: "QueryHost Fixture",
        map: "chernarusplus",
        folder: "dayz",
        game: "DayZ",
        appId: 0,
        players: 35,
        maxPlayers: 60,
        bots: 0,
        serverType: "dedicated",
        environment: "windows",
        password: false,
        vac: true,
        version: "1.23.157045",
        extraDataFlags: 0xb1,
        port: 10_100,
        steamId: 0x0102_0304_0506_0708n,
        keywords: "fixture,public",
        gameId: 221_100n,
      },
    });
  });

  it("parses SourceTV and legacy macOS environment fields", async (): Promise<void> => {
    const packet = parseA2sInfoPacket(await readHexFixture("source-tv.hex"));

    expect(packet).toMatchObject({
      kind: "info",
      info: {
        format: "source",
        serverType: "proxy",
        environment: "macos",
        password: true,
        vac: false,
        extraDataFlags: 0x40,
        sourceTv: { port: 27_020, name: "QueryHost TV" },
      },
    });
  });

  it("parses the legacy GoldSource mod layout", async (): Promise<void> => {
    const packet = parseA2sInfoPacket(await readHexFixture("goldsource-mod.hex"));

    expect(packet).toEqual({
      kind: "info",
      info: {
        format: "goldsource",
        address: "127.0.0.1:27015",
        name: "QueryHost GoldSource",
        map: "crossfire",
        folder: "valve",
        game: "Half-Life",
        players: 5,
        maxPlayers: 32,
        protocol: 48,
        serverType: "dedicated",
        environment: "linux",
        password: false,
        mod: {
          link: "mod.example",
          downloadLink: "",
          version: 1,
          size: 123_456,
          multiplayerOnly: true,
          usesHalfLifeDll: false,
        },
        vac: true,
        bots: 2,
      },
    });
  });

  it("parses the legacy GoldSource layout without a mod block", async (): Promise<void> => {
    const packet = parseA2sInfoPacket(await readHexFixture("goldsource-basic.hex"));

    expect(packet).toMatchObject({
      kind: "info",
      info: {
        format: "goldsource",
        address: "192.0.2.1:27015",
        name: "Legacy Fixture",
        players: 0,
        maxPlayers: 16,
        serverType: "listen",
        environment: "macos",
        password: true,
        vac: false,
        bots: 0,
      },
    });
    if (packet.kind !== "info" || packet.info.format !== "goldsource") {
      throw new Error("Expected GoldSource info.");
    }
    expect(packet.info.mod).toBeUndefined();
  });

  it("parses a captured challenge token", async (): Promise<void> => {
    expect(parseA2sInfoPacket(await readHexFixture("challenge-captured.hex"))).toEqual({
      kind: "challenge",
      challenge: 0x6c08_816a,
    });
  });

  it("accepts a modern response with no EDF byte", async (): Promise<void> => {
    const withSourceTv = await readHexFixture("source-tv.hex");
    const withoutEdf = withSourceTv.subarray(0, 44);
    const packet = parseA2sInfoPacket(withoutEdf);

    expect(packet).toMatchObject({
      kind: "info",
      info: { format: "source", version: "1" },
    });
    if (packet.kind !== "info" || packet.info.format !== "source") {
      throw new Error("Expected Source info.");
    }
    expect(packet.info.extraDataFlags).toBeUndefined();
  });

  it("rejects every captured-response truncation except the valid no-EDF boundary", async (): Promise<void> => {
    const captured = await readHexFixture("source-captured-redacted.hex");

    for (let length = 0; length < captured.byteLength; length += 1) {
      if (length === 69) {
        expect(parseA2sInfoPacket(captured.subarray(0, length))).toMatchObject({
          kind: "info",
          info: { format: "source", version: "1.23.157045" },
        });
        continue;
      }
      expectProtocolFailure(
        () => parseA2sInfoPacket(captured.subarray(0, length)),
        "MALFORMED_RESPONSE",
      );
    }
  });

  it("rejects invalid UTF-8 and unterminated strings", async (): Promise<void> => {
    const captured = await readHexFixture("source-captured-redacted.hex");
    const invalidUtf8 = Uint8Array.from(captured);
    invalidUtf8[6] = 0xc3;
    invalidUtf8[7] = 0x28;

    expectProtocolFailure(() => parseA2sInfoPacket(invalidUtf8), "MALFORMED_RESPONSE");
    expectProtocolFailure(() => parseA2sInfoPacket(captured.subarray(0, 12)), "MALFORMED_RESPONSE");
  });

  it.each([
    Uint8Array.of(0, 0, 0, 0, 0x49),
    Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x7f),
    Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x41, 1, 2, 3),
    Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x41, 1, 2, 3, 4, 5),
  ])("rejects malformed headers, types, and challenge lengths", (packet): void => {
    expectProtocolFailure(() => parseA2sInfoPacket(packet), "MALFORMED_RESPONSE");
  });

  it("recognizes a split-packet header for Slice 6", (): void => {
    expectProtocolFailure(
      () => parseA2sInfoPacket(Uint8Array.of(0xfe, 0xff, 0xff, 0xff, 0x00)),
      "SPLIT_PACKET",
    );
  });

  it("rejects packets above the single-packet budget", (): void => {
    expectProtocolFailure(
      () => parseA2sInfoPacket(new Uint8Array(A2S_SINGLE_PACKET_MAX_BYTES + 1)),
      "MALFORMED_RESPONSE",
    );
  });

  it("rejects invalid enum, boolean, EDF, and trailing values", async (): Promise<void> => {
    const sourceTv = await readHexFixture("source-tv.hex");
    const mutations = [
      { offset: 38, value: 0x78 },
      { offset: 39, value: 0x78 },
      { offset: 40, value: 2 },
      { offset: 41, value: 2 },
      { offset: 44, value: 2 },
    ] as const;

    for (const mutation of mutations) {
      const packet = Uint8Array.from(sourceTv);
      packet[mutation.offset] = mutation.value;
      expectProtocolFailure(() => parseA2sInfoPacket(packet), "MALFORMED_RESPONSE");
    }

    const withTrailingByte = new Uint8Array(sourceTv.byteLength + 1);
    withTrailingByte.set(sourceTv);
    expectProtocolFailure(() => parseA2sInfoPacket(withTrailingByte), "MALFORMED_RESPONSE");
  });
});

describe("A2S Info exchange", (): void => {
  it("queries a direct Source response through a fake UDP server", async (): Promise<void> => {
    const response = await readHexFixture("source-captured-redacted.hex");
    const server = await startFakeUdpServer((socket, request, remote): void => {
      expect(request).toEqual(Buffer.from(BASE_REQUEST));
      send(socket, response, remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
    });
    scope.close();

    expect(result.info).toMatchObject({ format: "source", name: "QueryHost Fixture" });
    expect(result.challenged).toBe(false);
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
  });

  it("reconstructs an out-of-order split response from one fake UDP exchange", async (): Promise<void> => {
    const response = await readHexFixture("source-captured-redacted.hex");
    const splitAt = Math.ceil(response.byteLength / 2);
    const fragments = [
      sourceFragment(0x1234_5678, 2, 0, response.subarray(0, splitAt)),
      sourceFragment(0x1234_5678, 2, 1, response.subarray(splitAt)),
    ] as const;
    const server = await startFakeUdpServer((socket, request, remote): void => {
      expect(request).toEqual(Buffer.from(BASE_REQUEST));
      send(socket, fragments[1], remote.port, remote.address);
      send(socket, fragments[0], remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
    });
    scope.close();

    expect(result.info).toMatchObject({ format: "source", name: "QueryHost Fixture" });
    expect(result.challenged).toBe(false);
  });

  it("decompresses and parses a split response through a fake UDP exchange", async (): Promise<void> => {
    const compressed = Uint8Array.from(
      Buffer.from(
        "QlpoMTFBWSZTWVlPH7cAADP/mP/AIABIhX6EBWAgEL9l3vAABCAAAACgAGQ1U/SgGEeoHqDaT9KaPUGh4KeoYAaaNBpiAAABkBhJZBxCM2uW1eWoqeujSnVrVc+gk87WcLQZsybjqOSGI/O7XydmwSD8Wy6HuEJZ33vpBxJAljnMUTaE1qUEVjlvEU4/xdyRThQkFlPH7cA=",
        "base64",
      ),
    );
    const splitAt = Math.ceil(compressed.byteLength / 2);
    const fragments = [
      compressedCapturedSourceFragment(0x2345_6789, 2, 0, compressed.subarray(0, splitAt)),
      compressedCapturedSourceFragment(0x2345_6789, 2, 1, compressed.subarray(splitAt)),
    ] as const;
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(socket, fragments[1], remote.port, remote.address);
      send(socket, fragments[0], remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
    });
    scope.close();

    expect(result.info).toMatchObject({ format: "source", name: "QueryHost Fixture" });
  });

  it("retries once with the exact challenge returned by a fake server", async (): Promise<void> => {
    const challenge = await readHexFixture("challenge-captured.hex");
    const response = await readHexFixture("source-captured-redacted.hex");
    let requests = 0;
    const server = await startFakeUdpServer((socket, request, remote): void => {
      requests += 1;
      if (requests === 1) {
        expect(request).toEqual(Buffer.from(BASE_REQUEST));
        send(socket, challenge, remote.port, remote.address);
        return;
      }

      expect(request.subarray(0, BASE_REQUEST.byteLength)).toEqual(Buffer.from(BASE_REQUEST));
      expect([...request.subarray(BASE_REQUEST.byteLength)]).toEqual([0x6a, 0x81, 0x08, 0x6c]);
      send(socket, response, remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
    });
    scope.close();

    expect(requests).toBe(2);
    expect(result.challenged).toBe(true);
    expect(result.info).toMatchObject({ format: "source", name: "QueryHost Fixture" });
  });

  it("queries a legacy GoldSource response through a fake UDP server", async (): Promise<void> => {
    const response = await readHexFixture("goldsource-basic.hex");
    const server = await startFakeUdpServer((socket, request, remote): void => {
      expect(request).toEqual(Buffer.from(BASE_REQUEST));
      send(socket, response, remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
    });
    scope.close();

    expect(result.info).toMatchObject({ format: "goldsource", name: "Legacy Fixture" });
  });

  it("rejects a truncated response received from a fake UDP server", async (): Promise<void> => {
    const response = await readHexFixture("source-captured-redacted.hex");
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(socket, response.subarray(0, response.byteLength - 1), remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    await expect(
      queryA2sInfo({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
      }),
    ).rejects.toSatisfy(expectProtocolCode("MALFORMED_RESPONSE"));
    scope.close();
  });

  it("rejects a second challenge without performing an unbounded retry", async (): Promise<void> => {
    const challenge = await readHexFixture("challenge-captured.hex");
    let requests = 0;
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      requests += 1;
      send(socket, challenge, remote.port, remote.address);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    await expect(
      queryA2sInfo({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
      }),
    ).rejects.toSatisfy(expectProtocolCode("CHALLENGE_LIMIT"));
    scope.close();
    expect(requests).toBe(2);
  });

  it("adds both exchange durations after a challenge", async (): Promise<void> => {
    const challenge = await readHexFixture("challenge-captured.hex");
    const response = await readHexFixture("source-captured-redacted.hex");
    const replies = [challenge, response] as const;
    let exchangeIndex = 0;
    const dependencies: A2sInfoDependencies = {
      collect(options: UdpCollectionOptions): Promise<UdpCollectionResult> {
        const data = replies[exchangeIndex];
        exchangeIndex += 1;
        if (data === undefined) {
          throw new Error("No response remains.");
        }
        return Promise.resolve({
          datagrams: Object.freeze([data]),
          rttMs: exchangeIndex * 3,
          address: options.address,
          port: options.target.port,
        });
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const result = await queryA2sInfo(
      { scope, target: createTarget(27_015), address: LOOPBACK_ADDRESS },
      dependencies,
    );
    scope.close();

    expect(result.rttMs).toBe(9);
  });
});
