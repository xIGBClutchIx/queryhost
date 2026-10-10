import { createServer, type Socket } from "node:net";

import { describe, expect, it } from "vitest";

import type { PinnedTarget } from "../../../src/network/target.js";
import { MinecraftJavaProtocolError } from "../../../src/protocols/minecraft-java/errors.js";
import {
  encodeMinecraftLegacyPing,
  inspectMinecraftLegacyResponse,
  MINECRAFT_LEGACY_MAX_RESPONSE_BYTES,
  parseMinecraftLegacyResponse,
  queryMinecraftLegacyStatus,
} from "../../../src/protocols/minecraft-java/legacy.js";
import { createExecutionContext } from "../../../src/runtime/execution.js";

function kick(text: string, declaredCharacters = text.length): Uint8Array {
  const bytes = new Uint8Array(3 + text.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 0xff);
  view.setUint16(1, declaredCharacters);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(3 + index * 2, text.charCodeAt(index));
  }
  return bytes;
}

function hex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value.replaceAll(" ", ""), "hex"));
}

function expectProtocolError(action: () => void, code: MinecraftJavaProtocolError["code"]): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MinecraftJavaProtocolError);
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error("Expected a Minecraft Java protocol error.");
}

const MODERN = "§1\u000078\u00001.6.4\u0000§aA Server\u00002\u000020";

describe("Minecraft Java legacy ping", (): void => {
  it("encodes the 1.6 ping with an MC|PingHost plugin message", (): void => {
    expect(encodeMinecraftLegacyPing("localhost", 25_565)).toEqual(
      hex(
        "fe 01 fa 000b 004d0043007c00500069006e00670048006f00730074" +
          " 0019 4a 0009 006c006f00630061006c0068006f00730074 000063dd",
      ),
    );
  });

  it("rejects hostnames and ports the ping cannot carry", (): void => {
    expectProtocolError(() => encodeMinecraftLegacyPing("", 25_565), "INVALID_INPUT");
    expectProtocolError(() => encodeMinecraftLegacyPing("a\0b", 25_565), "INVALID_INPUT");
    expectProtocolError(() => encodeMinecraftLegacyPing("a".repeat(256), 25_565), "INVALID_INPUT");
    expectProtocolError(() => encodeMinecraftLegacyPing("localhost", 0), "INVALID_INPUT");
    expectProtocolError(() => encodeMinecraftLegacyPing("localhost", 65_536), "INVALID_INPUT");
  });

  it("frames fragmented kick packets by their declared character count", (): void => {
    const packet = kick(MODERN);
    expect(inspectMinecraftLegacyResponse(packet.subarray(0, 0))).toBe("incomplete");
    expect(inspectMinecraftLegacyResponse(packet.subarray(0, 2))).toBe("incomplete");
    expect(inspectMinecraftLegacyResponse(packet.subarray(0, packet.byteLength - 1))).toBe(
      "incomplete",
    );
    expect(inspectMinecraftLegacyResponse(packet)).toBe("complete");
    expect(inspectMinecraftLegacyResponse(Uint8Array.of(...packet, 0))).toBe("malformed");
    expect(inspectMinecraftLegacyResponse(Uint8Array.of(0x00, 0x00, 0x01))).toBe("malformed");
    expect(inspectMinecraftLegacyResponse(Uint8Array.of(0xff, 0x00, 0x00))).toBe("malformed");
    expect(inspectMinecraftLegacyResponse(Uint8Array.of(0xff, 0x08, 0x01))).toBe("too-large");
    expect(MINECRAFT_LEGACY_MAX_RESPONSE_BYTES).toBe(3 + 2_048 * 2);
  });

  it("parses the 1.4+ layout with version, protocol, and formatted MOTD", (): void => {
    expect(parseMinecraftLegacyResponse(kick(MODERN))).toEqual({
      versionName: "1.6.4",
      protocolVersion: 78,
      playersOnline: 2,
      playersMax: 20,
      motd: { plain: "A Server", html: '<span style="color:#55ff55">A Server</span>' },
    });
  });

  it("keeps a confirmed empty version name and MOTD", (): void => {
    expect(parseMinecraftLegacyResponse(kick("§1\u0000-1\u0000\u0000\u00000\u00000"))).toEqual({
      versionName: "",
      protocolVersion: -1,
      playersOnline: 0,
      playersMax: 0,
      motd: { plain: "", html: "" },
    });
  });

  it("parses the Beta 1.8 to 1.3 layout without inventing version facts", (): void => {
    const status = parseMinecraftLegacyResponse(kick("Old <b>World§5§12"));
    expect(status).toEqual({
      playersOnline: 5,
      playersMax: 12,
      motd: { plain: "Old <b>World", html: "Old &lt;b&gt;World" },
    });
    expect("versionName" in status).toBe(false);
    expect("protocolVersion" in status).toBe(false);
  });

  it.each([
    ["too few 1.4+ fields", "§1\u000078\u00001.6.4\u0000motd\u00002"],
    ["too many 1.4+ fields", `${MODERN}\u00001`],
    ["a non-numeric protocol", "§1\u0000x\u00001.6.4\u0000motd\u00002\u000020"],
    ["a negative player count", "§1\u000078\u00001.6.4\u0000motd\u0000-2\u000020"],
    ["a fractional player count", "§1\u000078\u00001.6.4\u0000motd\u00002.5\u000020"],
    ["an out-of-range player count", "§1\u000078\u00001.6.4\u0000motd\u00002\u00004294967296"],
    ["an empty player count", "§1\u000078\u00001.6.4\u0000motd\u0000\u000020"],
    ["too few old fields", "motd§2"],
    ["formatting in an old MOTD", "§amotd§2§20"],
    ["a NUL in the old layout", "mo\u0000td§2§20"],
    ["a lone surrogate", "\ud800§2§20"],
  ])("rejects %s", (_name, text): void => {
    expectProtocolError(() => parseMinecraftLegacyResponse(kick(text)), "MALFORMED_RESPONSE");
  });

  it("rejects incomplete, trailing, and oversized packets", (): void => {
    const packet = kick(MODERN);
    expectProtocolError(
      () => parseMinecraftLegacyResponse(packet.subarray(0, packet.byteLength - 2)),
      "MALFORMED_RESPONSE",
    );
    expectProtocolError(
      () => parseMinecraftLegacyResponse(Uint8Array.of(...packet, 0, 0)),
      "MALFORMED_RESPONSE",
    );
    expectProtocolError(
      () => parseMinecraftLegacyResponse(kick("a".repeat(2_049))),
      "RESPONSE_TOO_LARGE",
    );
  });

  it("queries a server that reads only FE 01 over one pinned TCP connection", async (): Promise<void> => {
    const sockets = new Set<Socket>();
    const server = createServer((socket): void => {
      sockets.add(socket);
      socket.once("close", (): void => {
        sockets.delete(socket);
      });
      socket.once("data", (part): void => {
        // A 1.4 or 1.5 server answers as soon as it sees FE 01 and closes the connection.
        expect([part[0], part[1]]).toEqual([0xfe, 0x01]);
        const response = kick(MODERN);
        socket.write(response.subarray(0, 2));
        setTimeout((): void => {
          socket.end(response.subarray(2));
        }, 5);
      });
    });
    await new Promise<void>((resolve): void => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const listening = server.address();
    if (listening === null || typeof listening === "string") {
      throw new Error("The fake Minecraft server did not expose an IP port.");
    }
    const target: PinnedTarget = Object.freeze({
      hostname: "fake.example",
      port: listening.port,
      addresses: Object.freeze([Object.freeze({ address: "127.0.0.1", family: 4 })]),
    });
    const address = target.addresses[0];
    if (address === undefined) {
      throw new Error("The fake target is missing its pinned address.");
    }
    const scope = createExecutionContext({ timeoutMs: 500 });
    try {
      const result = await queryMinecraftLegacyStatus({ scope, target, address });
      expect(result.status).toMatchObject({ versionName: "1.6.4", playersOnline: 2 });
      expect(result.rttMs).toBeGreaterThanOrEqual(0);
    } finally {
      scope.close();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve): void => {
        server.close((): void => {
          resolve();
        });
      });
    }
  });
});
