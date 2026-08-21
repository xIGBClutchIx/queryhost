import type { Socket } from "node:dgram";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createExecutionContext } from "../src/execution.js";
import { MinecraftJavaProtocolError } from "../src/protocols/minecraft-java/errors.js";
import {
  createMinecraftQuerySessionId,
  encodeMinecraftQueryFullStat,
  encodeMinecraftQueryHandshake,
  parseMinecraftQueryChallenge,
  parseMinecraftQueryStat,
  queryMinecraftFullStat,
} from "../src/protocols/minecraft-java/query.js";
import type { PinnedTarget } from "../src/target.js";
import { startFakeUdpServer, stopAllFakeUdpServers } from "./helpers/fake-udp-server.js";

const SESSION_ID = 0x0102_0304;
const FULL_HEADER = Uint8Array.of(0x73, 0x70, 0x6c, 0x69, 0x74, 0x6e, 0x75, 0x6d, 0x00, 0x80, 0x00);
const PLAYER_SECTION = Uint8Array.of(0x01, 0x70, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x00, 0x00);
const FULL_STAT_FIXTURE = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL("./fixtures/minecraft-java/query-full-stat.hex", import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  ),
);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function int32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value);
  return bytes;
}

function uint16LittleEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function string(value: string): Uint8Array {
  return concat([new TextEncoder().encode(value), Uint8Array.of(0)]);
}

function challenge(token: string, sessionId = SESSION_ID): Uint8Array {
  return concat([Uint8Array.of(0x09), int32(sessionId), string(token)]);
}

function fullStat(
  fields: readonly (readonly [string, string])[],
  players: readonly string[],
  sessionId = SESSION_ID,
): Uint8Array {
  const values = fields.flatMap(([key, value]) => [string(key), string(value)]);
  return concat([
    Uint8Array.of(0x00),
    int32(sessionId),
    FULL_HEADER,
    ...values,
    Uint8Array.of(0),
    PLAYER_SECTION,
    ...players.map(string),
    Uint8Array.of(0),
  ]);
}

function basicStat(sessionId = SESSION_ID): Uint8Array {
  return concat([
    Uint8Array.of(0x00),
    int32(sessionId),
    string("QueryHost"),
    string("SMP"),
    string("world"),
    string("2"),
    string("20"),
    uint16LittleEndian(25_565),
    string("203.0.113.10"),
  ]);
}

function protocolCode(code: MinecraftJavaProtocolError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof MinecraftJavaProtocolError && error.code === code;
}

function send(socket: Socket, message: Uint8Array, port: number, address: string): void {
  socket.send(message, port, address);
}

afterEach(async (): Promise<void> => {
  await stopAllFakeUdpServers();
});

describe("Minecraft Query packet primitives", (): void => {
  it("encodes deterministic handshake and full-stat requests", (): void => {
    expect([...encodeMinecraftQueryHandshake(SESSION_ID)]).toEqual([
      0xfe, 0xfd, 0x09, 0x01, 0x02, 0x03, 0x04,
    ]);
    expect([...encodeMinecraftQueryFullStat(SESSION_ID, -123)]).toEqual([
      0xfe, 0xfd, 0x00, 0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0x85, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(createMinecraftQuerySessionId((): number => 0.5)).toBe(0);
  });

  it("parses a signed challenge token for the expected session", (): void => {
    expect(parseMinecraftQueryChallenge(challenge("-123"), SESSION_ID)).toBe(-123);
  });

  it.each([
    challenge("123", 1),
    concat([challenge("123"), Uint8Array.of(0)]),
    challenge("01"),
    challenge("2147483648"),
    challenge("not-a-number"),
    challenge("123").slice(0, -1),
  ])("rejects malformed challenge responses", (packet): void => {
    expect(() => parseMinecraftQueryChallenge(packet, SESSION_ID)).toThrow(
      expect.toSatisfy(
        (error: Error): boolean =>
          error instanceof MinecraftJavaProtocolError &&
          (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"),
      ),
    );
  });

  it("rejects invalid session and token inputs", (): void => {
    expect(() => encodeMinecraftQueryHandshake(-1)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
    expect(() => encodeMinecraftQueryFullStat(SESSION_ID, 2_147_483_648)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
    expect(() => createMinecraftQuerySessionId((): number => 1)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
  });
});

describe("Minecraft Query stat parsing", (): void => {
  it("parses bounded full-stat fields, software, plugins, and player names", (): void => {
    expect(parseMinecraftQueryStat(FULL_STAT_FIXTURE, SESSION_ID)).toEqual({
      format: "full",
      motd: "QueryHost Server",
      gameType: "SMP",
      map: "world",
      playersOnline: 2,
      playersMax: 20,
      hostPort: 25_565,
      hostIp: "203.0.113.10",
      version: "1.21.4",
      software: { name: "Paper on Bukkit 1.21.4" },
      plugins: [
        { name: "EssentialsX", version: "2.20.1" },
        { name: "World Edit", version: "7.3.0" },
        { name: "LuckPerms" },
      ],
      players: ["Alex", "Steve"],
    });
  });

  it("preserves confirmed empty plugin and player lists", (): void => {
    expect(parseMinecraftQueryStat(fullStat([["plugins", ""]], []), SESSION_ID)).toMatchObject({
      plugins: [],
      players: [],
    });
  });

  it("parses the basic-stat layout without inventing player names or plugin data", (): void => {
    expect(parseMinecraftQueryStat(basicStat(), SESSION_ID)).toEqual({
      format: "basic",
      motd: "QueryHost",
      gameType: "SMP",
      map: "world",
      playersOnline: 2,
      playersMax: 20,
      hostPort: 25_565,
      hostIp: "203.0.113.10",
    });
  });

  it.each([
    fullStat([["map", "world"]], [], 1),
    fullStat(
      [
        ["map", "world"],
        ["map", "other"],
      ],
      [],
    ),
    fullStat([["numplayers", "-1"]], []),
    fullStat([["hostport", "65536"]], []),
    fullStat([["x".repeat(65), "value"]], []),
    fullStat([["map", "world"]], []).slice(0, -1),
  ])("rejects malformed or excessive full-stat layouts", (response): void => {
    expect(() => parseMinecraftQueryStat(response, SESSION_ID)).toThrow(
      expect.toSatisfy(
        (error: Error): boolean =>
          error instanceof MinecraftJavaProtocolError &&
          (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"),
      ),
    );
  });
});

describe("Minecraft Query network exchange", (): void => {
  it("uses one UDP endpoint for challenge and full stat", async (): Promise<void> => {
    const clientPorts = new Set<number>();
    let sessionId: number | undefined;
    const server = await startFakeUdpServer((socket, message, remote): void => {
      clientPorts.add(remote.port);
      const type = message[2];
      if (type === 0x09) {
        sessionId = new DataView(message.buffer, message.byteOffset + 3, 4).getInt32(0);
        send(socket, challenge("12345", sessionId), remote.port, remote.address);
      } else if (type === 0x00 && sessionId !== undefined) {
        expect(new DataView(message.buffer, message.byteOffset + 7, 4).getInt32(0)).toBe(12_345);
        send(
          socket,
          fullStat(
            [
              ["map", "world"],
              ["numplayers", "1"],
              ["maxplayers", "20"],
            ],
            ["Alex"],
            sessionId,
          ),
          remote.port,
          remote.address,
        );
      }
    });
    const target: PinnedTarget = Object.freeze({
      hostname: "fake.example",
      port: server.port,
      addresses: Object.freeze([Object.freeze({ address: "127.0.0.1", family: 4 })]),
    });
    const address = target.addresses[0];
    if (address === undefined) {
      throw new Error("The fake Query target is missing its pinned address.");
    }
    const scope = createExecutionContext({ timeoutMs: 500 });
    try {
      const result = await queryMinecraftFullStat({
        scope,
        target,
        address,
        sessionId: SESSION_ID,
      });
      expect(result.stat).toMatchObject({ map: "world", players: ["Alex"] });
      expect(result.rttMs).toBeGreaterThanOrEqual(0);
      expect(clientPorts.size).toBe(1);
    } finally {
      scope.close();
    }
  });
});
