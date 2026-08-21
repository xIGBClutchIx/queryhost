import { describe, expect, it, vi } from "vitest";

import { queryWithDependencies, type QueryDependencies } from "../src/client.js";
import type { MinecraftBedrockPingDependencies } from "../src/protocols/minecraft-bedrock/ping.js";
import type { DnsAddressRecord, DnsResolver } from "../src/target.js";
import { UdpTransportError } from "../src/transports/udp.js";

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
const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const FIELDS = [
  "MCPE",
  "QueryHost Bedrock",
  "900",
  "1.21.100",
  "12",
  "50",
  "18364758544493064720",
  "Bedrock level",
  "Survival",
  "0",
  "19140",
  "19141",
] as const;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function pong(request: Uint8Array, fields: readonly string[] = FIELDS): Uint8Array {
  const payload = new TextEncoder().encode(`${fields.join(";")};`);
  const header = new Uint8Array(35);
  const view = new DataView(header.buffer);
  header[0] = 0x1c;
  view.setBigUint64(
    1,
    new DataView(request.buffer, request.byteOffset, request.byteLength).getBigUint64(1),
  );
  view.setBigUint64(9, 0xfedc_ba98_7654_3210n);
  header.set(MAGIC, 17);
  view.setUint16(33, payload.byteLength);
  return concat([header, payload]);
}

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function dependencies(
  minecraftBedrock: MinecraftBedrockPingDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let nowCalls = 0;
  return {
    resolver: dns,
    minecraftBedrock,
    random: (): number => 0.5,
    now(): number {
      nowCalls += 1;
      return nowCalls === 1 ? 100 : 125;
    },
  };
}

describe("Minecraft Bedrock game profile", (): void => {
  it("returns a typed canonical result and preserves advertised ports", async (): Promise<void> => {
    const destinationPorts: number[] = [];
    const ping: MinecraftBedrockPingDependencies = {
      exchange(options) {
        destinationPorts.push(options.target.port);
        return Promise.resolve({
          data: pong(options.request),
          rttMs: 7,
          address: options.address,
          port: options.target.port,
        });
      },
    };
    const result = await queryWithDependencies(
      {
        game: "mcbe",
        host: "play.example.com",
        port: 19_135,
        queryPort: 19_136,
      },
      dependencies(ping),
    );

    expect(result).toEqual({
      ok: true,
      game: "minecraft-bedrock",
      server: {
        name: "QueryHost Bedrock",
        version: "1.21.100",
        players: { online: 12, max: 50 },
        queryRttMs: 7,
      },
      data: {
        edition: "MCPE",
        motd: "QueryHost Bedrock",
        protocolVersion: 900,
        gameMode: "Survival",
        serverId: "18364758544493064720",
        advertisedIpv4Port: 19_140,
        advertisedIpv6Port: 19_141,
      },
      sources: [{ source: "minecraft-bedrock-raknet", status: "ok", rttMs: 7 }],
      warnings: [],
      partial: false,
      durationMs: 25,
    });
    expect(destinationPorts).toEqual([19_136]);
  });

  it("uses port 19132 by default and falls back across pinned addresses", async (): Promise<void> => {
    const addresses: string[] = [];
    const ping: MinecraftBedrockPingDependencies = {
      exchange(options) {
        addresses.push(options.address.address);
        if (options.address.address === "1.1.1.1") {
          return Promise.reject(new UdpTransportError("CONNECTION_FAILED"));
        }
        expect(options.target.port).toBe(19_132);
        return Promise.resolve({
          data: pong(options.request),
          rttMs: 8,
          address: options.address,
          port: options.target.port,
        });
      },
    };
    const result = await queryWithDependencies(
      { game: "minecraft-bedrock", host: "play.example.com" },
      dependencies(
        ping,
        resolver([
          { address: "1.1.1.1", family: 4 },
          { address: "8.8.8.8", family: 4 },
        ]),
      ),
    );

    expect(result.ok).toBe(true);
    expect(addresses).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("does not invent fields omitted by a valid partial advertisement", async (): Promise<void> => {
    const ping: MinecraftBedrockPingDependencies = {
      exchange(options) {
        return Promise.resolve({
          data: pong(options.request, ["MCEE"]),
          rttMs: 4,
          address: options.address,
          port: options.target.port,
        });
      },
    };
    const result = await queryWithDependencies(
      { game: "bedrock", host: "play.example.com" },
      dependencies(ping),
    );

    expect(result).toMatchObject({
      ok: true,
      server: { queryRttMs: 4 },
      data: { edition: "MCEE" },
      partial: false,
    });
    if (result.ok && result.game === "minecraft-bedrock") {
      expect(result.server.name).toBeUndefined();
      expect(result.server.players).toBeUndefined();
      expect(result.data.advertisedIpv4Port).toBeUndefined();
    }
  });

  it("maps malformed pongs into a stable required-source failure", async (): Promise<void> => {
    const ping: MinecraftBedrockPingDependencies = {
      exchange(options) {
        return Promise.resolve({
          data: pong(options.request).slice(0, -1),
          rttMs: 4,
          address: options.address,
          port: options.target.port,
        });
      },
    };
    const result = await queryWithDependencies(
      { game: "minecraft-bedrock", host: "play.example.com" },
      dependencies(ping),
    );

    expect(result).toEqual({
      ok: false,
      game: "minecraft-bedrock",
      error: {
        code: "MALFORMED_RESPONSE",
        message: "The Minecraft Bedrock response was malformed.",
        source: "minecraft-bedrock-raknet",
      },
      durationMs: 25,
      sources: [{ source: "minecraft-bedrock-raknet", status: "malformed" }],
      warnings: [],
    });
  });

  it("attributes required-source transport timeouts to RakNet", async (): Promise<void> => {
    const ping: MinecraftBedrockPingDependencies = {
      exchange: () => Promise.reject(new UdpTransportError("TIMEOUT")),
    };
    const result = await queryWithDependencies(
      { game: "minecraft-bedrock", host: "play.example.com" },
      dependencies(ping),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "minecraft-bedrock",
      error: { code: "TIMEOUT", source: "minecraft-bedrock-raknet" },
      sources: [{ source: "minecraft-bedrock-raknet", status: "timeout" }],
      warnings: [],
    });
  });
});
