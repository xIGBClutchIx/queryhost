import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { createExecutionContext } from "../src/execution.js";
import { MinecraftJavaProtocolError } from "../src/protocols/minecraft-java/errors.js";
import {
  encodeMinecraftStatusRequest,
  inspectMinecraftStatusResponse,
  parseMinecraftStatusResponse,
  queryMinecraftStatus,
} from "../src/protocols/minecraft-java/status.js";
import { encodeVarInt, readVarInt } from "../src/protocols/minecraft-java/varint.js";
import type { PinnedTarget } from "../src/target.js";

const STATUS_FIXTURE = readFileSync(
  new URL("./fixtures/minecraft-java/status.json", import.meta.url),
  "utf8",
).trim();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function statusPacket(text: string): Uint8Array {
  const json = new TextEncoder().encode(text);
  const payload = concat([encodeVarInt(0), encodeVarInt(json.byteLength), json]);
  return concat([encodeVarInt(payload.byteLength), payload]);
}

function statusDocument(overrides = ""): string {
  if (overrides === "") {
    return STATUS_FIXTURE;
  }
  return `{"version":{"name":"1.21.8","protocol":772},"players":{"max":20,"online":3},"description":{"text":"QueryHost","color":"green","bold":true}${overrides}}`;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const bytes = new Uint8Array(12 + data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.byteLength);
  bytes.set(typeBytes, 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(bytes.subarray(4, 8 + data.byteLength)));
  return bytes;
}

function fixtureFavicon(width = 64, height = 64): string {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header.set(Uint8Array.of(8, 6, 0, 0, 0), 8);
  const bytes = concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array()),
    pngChunk("IEND", new Uint8Array()),
  ]);
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject): void => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", (): void => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fake Minecraft server did not expose an IP port.");
  }
  return address.port;
}

async function closeServer(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve, reject): void => {
    server.close((error): void => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function protocolCode(code: MinecraftJavaProtocolError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof MinecraftJavaProtocolError && error.code === code;
}

describe("Minecraft Java VarInts", (): void => {
  it.each([
    [0, [0x00]],
    [1, [0x01]],
    [127, [0x7f]],
    [128, [0x80, 0x01]],
    [2_147_483_647, [0xff, 0xff, 0xff, 0xff, 0x07]],
    [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
    [-2_147_483_648, [0x80, 0x80, 0x80, 0x80, 0x08]],
  ] as const)("round-trips %s canonically", (value, bytes): void => {
    const encoded = encodeVarInt(value);
    expect([...encoded]).toEqual(bytes);
    expect(readVarInt(encoded)).toEqual({ kind: "value", value, nextOffset: bytes.length });
  });

  it("distinguishes fragmented input from malformed encodings", (): void => {
    expect(readVarInt(Uint8Array.of(0x80))).toEqual({ kind: "incomplete" });
    expect(() => readVarInt(Uint8Array.of(0x80, 0x00))).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
    expect(() => readVarInt(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x10))).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
    expect(() => encodeVarInt(2_147_483_648)).toThrow(
      expect.toSatisfy(protocolCode("INVALID_INPUT")),
    );
  });
});

describe("Minecraft Java status protocol", (): void => {
  it("encodes a handshake and status request with the requested host and port", (): void => {
    const request = encodeMinecraftStatusRequest("play.example.com", 25_565);
    expect(request.byteLength).toBeGreaterThan(20);
    expect(new TextDecoder().decode(request)).toContain("play.example.com");
    expect([...request.slice(-2)]).toEqual([0x01, 0x00]);
  });

  it("recognizes fragmented framing and parses a typed status", (): void => {
    const packet = statusPacket(statusDocument(`,"favicon":"${fixtureFavicon()}"`));
    expect(inspectMinecraftStatusResponse(packet.slice(0, 1))).toBe("incomplete");
    expect(inspectMinecraftStatusResponse(packet.slice(0, -1))).toBe("incomplete");
    expect(inspectMinecraftStatusResponse(packet)).toBe("complete");
    expect(parseMinecraftStatusResponse(packet)).toEqual({
      versionName: "1.21.8",
      protocolVersion: 772,
      playersOnline: 3,
      playersMax: 20,
      motd: {
        plain: "QueryHost",
        html: '<span style="color:#55ff55;font-weight:bold">QueryHost</span>',
      },
      favicon: fixtureFavicon(),
    });
  });

  it("queries a fragmented status from a real TCP server", async (): Promise<void> => {
    const response = statusPacket(statusDocument());
    const sockets = new Set<Socket>();
    let receivedRequest: (() => void) | undefined;
    const requestReceived = new Promise<void>((resolve): void => {
      receivedRequest = resolve;
    });
    const server = createServer((socket): void => {
      sockets.add(socket);
      socket.once("close", (): void => {
        sockets.delete(socket);
      });
      const requestParts: Uint8Array[] = [];
      socket.on("data", (part): void => {
        requestParts.push(Uint8Array.from(part));
        if (!new TextDecoder().decode(concat(requestParts)).includes("fake.example")) {
          return;
        }
        socket.removeAllListeners("data");
        receivedRequest?.();
        socket.write(response.slice(0, 1));
        setTimeout((): void => {
          socket.write(response.slice(1, 5));
          setTimeout((): void => {
            socket.end(response.slice(5));
          }, 5);
        }, 5);
      });
    });
    const port = await listen(server);
    const target: PinnedTarget = Object.freeze({
      hostname: "fake.example",
      port,
      addresses: Object.freeze([Object.freeze({ address: "127.0.0.1", family: 4 })]),
    });
    const address = target.addresses[0];
    if (address === undefined) {
      throw new Error("The fake target is missing its pinned address.");
    }
    const scope = createExecutionContext({ timeoutMs: 500 });
    try {
      const result = await queryMinecraftStatus({ scope, target, address });
      expect(result).toMatchObject({
        status: {
          versionName: "1.21.8",
          protocolVersion: 772,
          playersOnline: 3,
          playersMax: 20,
        },
      });
      expect(Number.isFinite(result.rttMs)).toBe(true);
      expect(result.rttMs).toBeGreaterThanOrEqual(0);
      await requestReceived;
    } finally {
      scope.close();
      await closeServer(server, sockets);
    }
  });

  it("normalizes legacy formatting, nested components, and untrusted HTML", (): void => {
    const document = JSON.stringify({
      version: { name: "Paper 1.21.8", protocol: 772 },
      players: { max: 100, online: 12 },
      description: {
        text: "§cDanger <script>",
        extra: [{ text: " safe", bold: true }, "\n§x§1§2§3§4§5§6Hex"],
      },
    });
    const status = parseMinecraftStatusResponse(statusPacket(document));
    expect(status.motd.plain).toBe("Danger <script> safe\nHex");
    expect(status.motd.html).not.toContain("<script>");
    expect(status.motd.html).toContain("&lt;script&gt;");
    expect(status.motd.html).toContain("color:#123456");
  });

  it.each([
    ["missing version", { players: { max: 1, online: 0 }, description: "Hi" }],
    [
      "fractional players",
      { version: { name: "1", protocol: 1 }, players: { max: 1.5, online: 0 }, description: "Hi" },
    ],
    [
      "invalid component",
      {
        version: { name: "1", protocol: 1 },
        players: { max: 1, online: 0 },
        description: { text: 1 },
      },
    ],
    [
      "invalid favicon",
      {
        version: { name: "1", protocol: 1 },
        players: { max: 1, online: 0 },
        description: "Hi",
        favicon: "data:text/plain;base64,SGk=",
      },
    ],
  ])("rejects a malformed document with %s", (_name, document): void => {
    expect(() => parseMinecraftStatusResponse(statusPacket(JSON.stringify(document)))).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
  });

  it("rejects invalid packet IDs, trailing bytes, invalid UTF-8, and excessive declarations", (): void => {
    const packet = statusPacket(statusDocument());
    const wrongId = Uint8Array.from(packet);
    const outer = readVarInt(wrongId);
    if (outer.kind !== "value") {
      throw new Error("Expected a complete fixture packet.");
    }
    wrongId[outer.nextOffset] = 1;
    expect(() => parseMinecraftStatusResponse(wrongId)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
    expect(inspectMinecraftStatusResponse(concat([packet, Uint8Array.of(0)]))).toBe("malformed");

    const invalidUtf8 = statusPacket(statusDocument());
    invalidUtf8[invalidUtf8.length - 1] = 0xff;
    expect(() => parseMinecraftStatusResponse(invalidUtf8)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
    expect(inspectMinecraftStatusResponse(encodeVarInt(300_000))).toBe("too-large");
  });

  it("bounds favicon dimensions and total status text", (): void => {
    const invalid = fixtureFavicon(32, 32);
    const badIcon = statusPacket(statusDocument(`,"favicon":"${invalid}"`));
    expect(() => parseMinecraftStatusResponse(badIcon)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );

    const corruptIcon = fixtureFavicon();
    const corruptBytes = Buffer.from(corruptIcon.slice(corruptIcon.indexOf(",") + 1), "base64");
    const lastByte = corruptBytes.at(-1);
    if (lastByte === undefined) {
      throw new Error("The favicon fixture is unexpectedly empty.");
    }
    corruptBytes[corruptBytes.length - 1] = lastByte ^ 1;
    const corrupt = `data:image/png;base64,${corruptBytes.toString("base64")}`;
    expect(() =>
      parseMinecraftStatusResponse(statusPacket(statusDocument(`,"favicon":"${corrupt}"`))),
    ).toThrow(expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")));

    const large = "x".repeat(32_768);
    const oversized = statusPacket(
      JSON.stringify({
        version: { name: "1", protocol: 1 },
        players: { max: 1, online: 0 },
        description: large,
      }),
    );
    expect(() => parseMinecraftStatusResponse(oversized)).toThrow(
      expect.toSatisfy(protocolCode("RESPONSE_TOO_LARGE")),
    );
  });
});
