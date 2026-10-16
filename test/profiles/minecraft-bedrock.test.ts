import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { QuerySourceEvent } from "../../src/contracts/shared.js";
import type { NetherNetDependencies } from "../../src/protocols/minecraft-bedrock/nethernet.js";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { MinecraftBedrockPingDependencies } from "../../src/protocols/minecraft-bedrock/ping.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import { UdpTransportError } from "../../src/transports/udp.js";
import { HttpTransportError } from "../../src/transports/http.js";

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
const NETHERNET = readFileSync(
  new URL("../fixtures/minecraft-bedrock/nethernet.json", import.meta.url),
);
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
    minecraftNetherNet: {
      exchange: () => Promise.reject(new HttpTransportError("CONNECTION_FAILED")),
    },
    random: (): number => 0.5,
    now(): number {
      nowCalls += 1;
      return nowCalls === 1 ? 100 : 125;
    },
  };
}

describe("Minecraft Bedrock game profile", (): void => {
  it.each(["summary", "full"] as const)(
    "prefers NetherNet in %s mode without sending a RakNet ping",
    async (mode): Promise<void> => {
      const exchange = vi.fn((options: Parameters<NetherNetDependencies["exchange"]>[0]) => {
        expect(options.target.port).toBe(19140);
        expect(options.address).toEqual(PUBLIC_ADDRESS);
        return Promise.resolve({
          statusCode: 200,
          data: NETHERNET,
          rttMs: 5,
          address: options.address,
          port: options.target.port,
        });
      });
      const ping = {
        exchange: vi.fn(() => Promise.reject(new UdpTransportError("CONNECTION_FAILED"))),
      };
      const dns = resolver();
      const events: QuerySourceEvent[] = [];
      const result = await queryWithDependencies(
        {
          game: "bedrock",
          host: "play.example.com",
          port: 19135,
          queryPort: 19140,
          mode,
          onSource: (event) => {
            events.push(event);
          },
        },
        { ...dependencies(ping, dns), minecraftNetherNet: { exchange } },
      );
      expect(result).toMatchObject({
        ok: true,
        partial: false,
        warnings: [],
        server: {
          name: "Dedicated Server",
          map: "Bedrock level",
          version: "1.26.52",
          players: { online: 0, max: 10 },
          queryRttMs: 5,
        },
        data: { transport: "nethernet", protocolVersion: 2193, gameType: 0, gameMode: "Survival" },
        sources: [
          { source: "minecraft-bedrock-nethernet", status: "ok", rttMs: 5 },
          { source: "minecraft-bedrock-raknet", status: "not-requested" },
        ],
      });
      expect(exchange).toHaveBeenCalledOnce();
      expect(ping.exchange).not.toHaveBeenCalled();
      expect(dns.resolveAddresses).toHaveBeenCalledOnce();
      expect(
        events.filter((event) => event.type === "completed").map((event) => event.report),
      ).toEqual(result.sources);
      if (result.ok && result.game === "minecraft-bedrock") {
        expect(result.data.edition).toBeUndefined();
        expect(result.data.serverId).toBeUndefined();
        expect(result.data.crossplay).toBeUndefined();
      }
    },
  );

  it.each(["", "{}", '{"players":0,"gameType":99}'])(
    "preserves missing metadata from capability response %j",
    async (body): Promise<void> => {
      const result = await queryWithDependencies(
        { game: "bedrock", host: "play.example.com" },
        {
          ...dependencies({ exchange: () => Promise.reject(new Error("must not ping")) }),
          minecraftNetherNet: {
            exchange: (options) =>
              Promise.resolve({
                statusCode: 200,
                data: new TextEncoder().encode(body),
                rttMs: 2,
                address: options.address,
                port: options.target.port,
              }),
          },
        },
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.game === "minecraft-bedrock") {
        expect(result.data.transport).toBe("nethernet");
        expect(result.server.name).toBeUndefined();
        expect(result.server.version).toBeUndefined();
        expect(result.server.players?.max).toBeUndefined();
        expect(result.data.gameMode).toBeUndefined();
      }
    },
  );

  it("falls back after malformed HTTP and reuses pinned addresses", async (): Promise<void> => {
    const dns = resolver([{ address: "1.1.1.1", family: 4 }, PUBLIC_ADDRESS]);
    const httpAddresses: string[] = [];
    const ping = {
      exchange: vi.fn((options: Parameters<MinecraftBedrockPingDependencies["exchange"]>[0]) =>
        Promise.resolve({
          data: pong(options.request),
          rttMs: 3,
          address: options.address,
          port: options.target.port,
        }),
      ),
    };
    const result = await queryWithDependencies(
      { game: "bedrock", host: "play.example.com" },
      {
        ...dependencies(ping, dns),
        minecraftNetherNet: {
          exchange: (options) => {
            httpAddresses.push(options.address.address);
            return Promise.resolve({
              statusCode: 200,
              data: new TextEncoder().encode("[]"),
              rttMs: 2,
              address: options.address,
              port: options.target.port,
            });
          },
        },
      },
    );
    expect(result).toMatchObject({
      ok: true,
      partial: false,
      data: { transport: "raknet" },
      sources: [
        { source: "minecraft-bedrock-nethernet", status: "malformed" },
        { source: "minecraft-bedrock-raknet", status: "ok" },
      ],
    });
    expect(httpAddresses).toEqual(["1.1.1.1", PUBLIC_ADDRESS.address]);
    expect(dns.resolveAddresses).toHaveBeenCalledOnce();
  });

  it("reserves time for RakNet when HTTP stays silent and closes HTTP before fallback", async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const resultPromise = queryWithDependencies(
        { game: "bedrock", host: "play.example.com", timeoutMs: 1000 },
        {
          ...dependencies({
            exchange: (options) => {
              expect(signals.every((signal) => signal.aborted)).toBe(true);
              return Promise.resolve({
                data: pong(options.request),
                rttMs: 3,
                address: options.address,
                port: options.target.port,
              });
            },
          }),
          minecraftNetherNet: {
            exchange: (options) =>
              new Promise((_resolve, reject) => {
                signals.push(options.scope.signal);
                options.scope.signal.addEventListener(
                  "abort",
                  () => {
                    reject(new HttpTransportError("TIMEOUT"));
                  },
                  { once: true },
                );
              }),
          },
        },
      );
      await vi.advanceTimersByTimeAsync(600);
      expect(await resultPromise).toMatchObject({
        ok: true,
        data: { transport: "raknet" },
        sources: [
          { source: "minecraft-bedrock-nethernet", status: "timeout" },
          { source: "minecraft-bedrock-raknet", status: "ok" },
        ],
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["http", "raknet"] as const)(
    "cancels during %s without continuing discovery or emitting late progress",
    async (phase): Promise<void> => {
      const controller = new AbortController();
      const events: QuerySourceEvent[] = [];
      let notify = (): void => undefined;
      const started = new Promise<void>((resolve) => {
        notify = resolve;
      });
      const ping = {
        exchange: vi.fn(
          (options: Parameters<MinecraftBedrockPingDependencies["exchange"]>[0]) =>
            new Promise<never>((_resolve, reject) => {
              notify();
              options.scope.signal.addEventListener(
                "abort",
                () => {
                  reject(new UdpTransportError("ABORTED"));
                },
                { once: true },
              );
            }),
        ),
      };
      const pending = queryWithDependencies(
        {
          game: "bedrock",
          host: "play.example.com",
          signal: controller.signal,
          onSource: (event) => {
            events.push(event);
          },
        },
        {
          ...dependencies(ping),
          minecraftNetherNet: {
            exchange: (options) =>
              phase === "raknet"
                ? Promise.reject(new HttpTransportError("CONNECTION_FAILED"))
                : new Promise<never>((_resolve, reject) => {
                    notify();
                    options.scope.signal.addEventListener(
                      "abort",
                      () => {
                        reject(new HttpTransportError("ABORTED"));
                      },
                      { once: true },
                    );
                  }),
          },
        },
      );
      await started;
      controller.abort();
      const result = await pending;
      expect(result).toMatchObject({ ok: false, error: { code: "ABORTED" } });
      if (phase === "http") expect(ping.exchange).not.toHaveBeenCalled();
      const count = events.length;
      await Promise.resolve();
      expect(events).toHaveLength(count);
      expect(
        events.filter((event) => event.type === "completed").map((event) => event.report),
      ).toEqual(result.sources);
    },
  );

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
        transport: "raknet",
        edition: "MCPE",
        motd: "QueryHost Bedrock",
        protocolVersion: 900,
        gameMode: "Survival",
        serverId: "18364758544493064720",
        advertisedIpv4Port: 19_140,
        advertisedIpv6Port: 19_141,
      },
      sources: [
        { source: "minecraft-bedrock-nethernet", status: "failed" },
        { source: "minecraft-bedrock-raknet", status: "ok", rttMs: 7 },
      ],
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

  it("hints at Geyser crossplay from its default sub-MOTD", async (): Promise<void> => {
    const fields: string[] = [...FIELDS];
    fields[7] = "Geyser";
    const ping: MinecraftBedrockPingDependencies = {
      exchange(options) {
        return Promise.resolve({
          data: pong(options.request, fields),
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
      data: { crossplay: { bridge: "geyser", evidence: "bedrock-sub-motd" } },
    });
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
      expect(result.data.crossplay).toBeUndefined();
    }
  });

  it("maps malformed RakNet after NetherNet fails into a stable required-source failure", async (): Promise<void> => {
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
      sources: [
        { source: "minecraft-bedrock-nethernet", status: "failed" },
        { source: "minecraft-bedrock-raknet", status: "malformed" },
      ],
      warnings: [],
    });
  });

  it("keeps RakNet timeout provenance when HTTP also fails", async (): Promise<void> => {
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
      sources: [
        { source: "minecraft-bedrock-nethernet", status: "failed" },
        { source: "minecraft-bedrock-raknet", status: "timeout" },
      ],
      warnings: [],
    });
  });
});
