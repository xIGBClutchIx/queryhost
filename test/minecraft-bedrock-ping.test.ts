import type { Socket } from "node:dgram";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createExecutionContext } from "../src/execution.js";
import { MinecraftBedrockProtocolError } from "../src/protocols/minecraft-bedrock/errors.js";
import {
  createMinecraftBedrockClientGuid,
  encodeMinecraftBedrockPing,
  parseMinecraftBedrockPong,
  queryMinecraftBedrockPing,
} from "../src/protocols/minecraft-bedrock/ping.js";
import type { PinnedTarget } from "../src/target.js";
import { UdpTransportError } from "../src/transports/udp.js";
import {
  startFakeUdpServer,
  stopAllFakeUdpServers,
  type FakeUdpServer,
} from "./helpers/fake-udp-server.js";

const MAGIC = Uint8Array.of(
  0x00,
  0xff,
  0xff,
  0x00,
  0xfe,
  0xfe,
  0xfe,
  0xfe,
  0xfd,
  0xfd,
  0xfd,
  0xfd,
  0x12,
  0x34,
  0x56,
  0x78,
);
const TIMESTAMP = 1_787_300_000_000n;
const CLIENT_GUID = 0x0102_0304_0506_0708n;
const SERVER_GUID = 0xfedc_ba98_7654_3210n;
const VALID_FIELDS = [
  "MCPE",
  "QueryHøst 世界",
  "900",
  "1.21.100",
  "12",
  "50",
  "18364758544493064720",
  "Bedrock level",
  "Survival",
  "0",
  "19132",
  "19133",
] as const;
const PONG_FIXTURE = Uint8Array.from(
  Buffer.from(
    readFileSync(new URL("./fixtures/minecraft-bedrock/pong.hex", import.meta.url), "utf8").trim(),
    "hex",
  ),
);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function pongPayload(fields: readonly string[], trailingDelimiter = true): Uint8Array {
  return new TextEncoder().encode(`${fields.join(";")}${trailingDelimiter ? ";" : ""}`);
}

function pongPacket(
  fields: readonly string[] = VALID_FIELDS,
  timestamp = TIMESTAMP,
  serverGuid = SERVER_GUID,
  trailingDelimiter = true,
): Uint8Array {
  const payload = pongPayload(fields, trailingDelimiter);
  const header = new Uint8Array(35);
  const view = new DataView(header.buffer);
  header[0] = 0x1c;
  view.setBigUint64(1, timestamp);
  view.setBigUint64(9, serverGuid);
  header.set(MAGIC, 17);
  view.setUint16(33, payload.byteLength);
  return concat([header, payload]);
}

function target(server: FakeUdpServer): PinnedTarget {
  return Object.freeze({
    hostname: server.host,
    port: server.port,
    addresses: Object.freeze([Object.freeze({ address: server.host, family: 4 })]),
  });
}

function protocolCode(code: MinecraftBedrockProtocolError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof MinecraftBedrockProtocolError && error.code === code;
}

function transportCode(code: UdpTransportError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof UdpTransportError && error.code === code;
}

function send(socket: Socket, data: Uint8Array, port: number, address: string): void {
  socket.send(data, port, address);
}

async function exchangeWith(server: FakeUdpServer) {
  const pinned = target(server);
  const address = pinned.addresses[0];
  if (address === undefined) {
    throw new Error("The fake Bedrock target has no address.");
  }
  const scope = createExecutionContext({ timeoutMs: 500 });
  try {
    return await queryMinecraftBedrockPing({
      scope,
      target: pinned,
      address,
      pingTimestamp: TIMESTAMP,
      clientGuid: CLIENT_GUID,
    });
  } finally {
    scope.close();
  }
}

afterEach(async (): Promise<void> => {
  await stopAllFakeUdpServers();
});

describe("Minecraft Bedrock RakNet primitives", (): void => {
  it("encodes the request ID, identifiers, and offline magic exactly", (): void => {
    const packet = encodeMinecraftBedrockPing(TIMESTAMP, CLIENT_GUID);
    expect(packet.byteLength).toBe(33);
    expect(packet[0]).toBe(0x01);
    expect(new DataView(packet.buffer).getBigUint64(1)).toBe(TIMESTAMP);
    expect(packet.subarray(9, 25)).toEqual(MAGIC);
    expect(new DataView(packet.buffer).getBigUint64(25)).toBe(CLIENT_GUID);
    expect(createMinecraftBedrockClientGuid((): number => 0.5)).toBe(0x8000_0000_8000_0000n);
  });

  it("rejects invalid request identifiers", (): void => {
    expect(() => encodeMinecraftBedrockPing(-1n, CLIENT_GUID)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
    expect(() => createMinecraftBedrockClientGuid((): number => 1)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
  });

  it("accepts missing optional fields without inventing values", (): void => {
    expect(parseMinecraftBedrockPong(pongPacket(["MCPE"], TIMESTAMP), TIMESTAMP)).toEqual({
      pingTimestamp: TIMESTAMP,
      serverGuid: SERVER_GUID,
      edition: "MCPE",
    });
  });

  it("parses the complete named pong fixture", (): void => {
    expect(parseMinecraftBedrockPong(PONG_FIXTURE, TIMESTAMP)).toMatchObject({
      edition: "MCPE",
      motd: "QueryHøst 世界",
      protocolVersion: 900,
      version: "1.21.100",
      playersOnline: 12,
      playersMax: 50,
      advertisedIpv4Port: 19_132,
      advertisedIpv6Port: 19_133,
    });
  });

  it.each([
    {
      label: "packet ID",
      mutate: (packet: Uint8Array): void => {
        packet[0] = 0x1d;
      },
    },
    {
      label: "ping identifier",
      mutate: (packet: Uint8Array): void => {
        new DataView(packet.buffer).setBigUint64(1, 1n);
      },
    },
    {
      label: "magic",
      mutate: (packet: Uint8Array): void => {
        packet[17] = 1;
      },
    },
  ])("rejects an invalid $label", ({ mutate }): void => {
    const packet = pongPacket();
    mutate(packet);
    expect(() => parseMinecraftBedrockPong(packet, TIMESTAMP)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
  });

  it.each([
    [2, "not-a-number"],
    [4, "-1"],
    [5, "1.5"],
    [6, "18446744073709551616"],
    [9, "creative"],
    [10, "0"],
    [11, "65536"],
  ])("rejects malformed numeric field %i", (index, value): void => {
    const fields: string[] = [...VALID_FIELDS];
    fields[index] = value;
    expect(() => parseMinecraftBedrockPong(pongPacket(fields), TIMESTAMP)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
  });

  it("rejects invalid UTF-8 without replacement characters", (): void => {
    const packet = pongPacket();
    packet[35] = 0xff;
    expect(() => parseMinecraftBedrockPong(packet, TIMESTAMP)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
  });

  it("enforces semicolon field count and per-field byte limits", (): void => {
    expect(() =>
      parseMinecraftBedrockPong(
        pongPacket(["MCPE", ...Array.from({ length: 32 }, (): string => "x")]),
        TIMESTAMP,
      ),
    ).toThrow(expect.toSatisfy(protocolCode("RESPONSE_TOO_LARGE")));
    expect(() =>
      parseMinecraftBedrockPong(pongPacket(["MCPE", "x".repeat(1_025)]), TIMESTAMP),
    ).toThrow(expect.toSatisfy(protocolCode("RESPONSE_TOO_LARGE")));
  });
});

describe("Minecraft Bedrock fake UDP exchange", (): void => {
  it("parses a valid UTF-8 pong and advertised ports", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, request, remote): void => {
      expect(request[0]).toBe(0x01);
      expect(new DataView(request.buffer, request.byteOffset).getBigUint64(1)).toBe(TIMESTAMP);
      expect(request.subarray(9, 25)).toEqual(Buffer.from(MAGIC));
      send(socket, pongPacket(), remote.port, remote.address);
    });

    await expect(exchangeWith(server)).resolves.toMatchObject({
      pong: {
        pingTimestamp: TIMESTAMP,
        serverGuid: SERVER_GUID,
        edition: "MCPE",
        motd: "QueryHøst 世界",
        protocolVersion: 900,
        version: "1.21.100",
        playersOnline: 12,
        playersMax: 50,
        serverId: "18364758544493064720",
        gameMode: "Survival",
        advertisedIpv4Port: 19_132,
        advertisedIpv6Port: 19_133,
      },
    });
  });

  it("accepts bounded extra fields at the maximum datagram size", async (): Promise<void> => {
    const prefix = `${VALID_FIELDS.join(";")};`;
    const remaining = 2_048 - 35 - new TextEncoder().encode(prefix).byteLength;
    const firstExtra = "a".repeat(1_000);
    const secondExtra = "b".repeat(remaining - firstExtra.length - 1);
    const response = pongPacket(
      [...VALID_FIELDS, firstExtra, secondExtra],
      TIMESTAMP,
      SERVER_GUID,
      false,
    );
    expect(response.byteLength).toBe(2_048);
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(socket, response, remote.port, remote.address);
    });

    await expect(exchangeWith(server)).resolves.toMatchObject({
      pong: { edition: "MCPE", advertisedIpv4Port: 19_132 },
    });
  });

  it("rejects a truncated pong", async (): Promise<void> => {
    const response = pongPacket().slice(0, -1);
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(socket, response, remote.port, remote.address);
    });
    await expect(exchangeWith(server)).rejects.toSatisfy(protocolCode("MALFORMED_RESPONSE"));
  });

  it("ignores a valid pong from a spoofed sender", async (): Promise<void> => {
    const spoof = await startFakeUdpServer((): void => undefined);
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(spoof.socket, pongPacket(), remote.port, remote.address);
      setTimeout((): void => {
        send(socket, pongPacket(), remote.port, remote.address);
      }, 10);
    });
    await expect(exchangeWith(server)).resolves.toMatchObject({ pong: { edition: "MCPE" } });
  });

  it("rejects an oversized pong at the transport boundary", async (): Promise<void> => {
    const prefix = `${VALID_FIELDS.join(";")};`;
    const remaining = 2_049 - 35 - new TextEncoder().encode(prefix).byteLength;
    const response = pongPacket(
      [...VALID_FIELDS, "a".repeat(1_000), "b".repeat(remaining - 1_001)],
      TIMESTAMP,
      SERVER_GUID,
      false,
    );
    expect(response.byteLength).toBe(2_049);
    const server = await startFakeUdpServer((socket, _request, remote): void => {
      send(socket, response, remote.port, remote.address);
    });
    await expect(exchangeWith(server)).rejects.toSatisfy(transportCode("RESPONSE_TOO_LARGE"));
  });
});
