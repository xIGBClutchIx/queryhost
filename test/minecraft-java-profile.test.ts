import { describe, expect, it, vi } from "vitest";

import { queryWithDependencies, type QueryDependencies } from "../src/client.js";
import type { MinecraftQueryDependencies } from "../src/protocols/minecraft-java/query.js";
import { encodeVarInt } from "../src/protocols/minecraft-java/varint.js";
import type { DnsAddressRecord, DnsResolver, DnsSrvRecord } from "../src/target.js";
import type { TcpSocketAdapter, TcpTransportDependencies } from "../src/transports/tcp.js";
import { UdpTransportError } from "../src/transports/udp.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const FULL_HEADER = Uint8Array.of(0x73, 0x70, 0x6c, 0x69, 0x74, 0x6e, 0x75, 0x6d, 0x00, 0x80, 0x00);
const PLAYER_SECTION = Uint8Array.of(0x01, 0x70, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x00, 0x00);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function int32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value);
  return bytes;
}

function string(value: string): Uint8Array {
  return concat([new TextEncoder().encode(value), Uint8Array.of(0)]);
}

function statusPacket(document: string): Uint8Array {
  const json = new TextEncoder().encode(document);
  const payload = concat([encodeVarInt(0), encodeVarInt(json.byteLength), json]);
  return concat([encodeVarInt(payload.byteLength), payload]);
}

const SUCCESS_RESPONSE = statusPacket(
  JSON.stringify({
    version: { name: "Paper 1.21.8", protocol: 772 },
    players: { max: 50, online: 7 },
    description: { text: "Query", color: "gold", extra: [{ text: "Host", bold: true }] },
  }),
);

function fullQueryResponse(sessionId: number): Uint8Array {
  const fields = [
    ["map", "world"],
    ["plugins", "Paper: EssentialsX 2.20.1; LuckPerms"],
    ["numplayers", "7"],
    ["maxplayers", "50"],
  ] as const;
  return concat([
    Uint8Array.of(0),
    int32(sessionId),
    FULL_HEADER,
    ...fields.flatMap(([key, value]) => [string(key), string(value)]),
    Uint8Array.of(0),
    PLAYER_SECTION,
    string("Alex"),
    Uint8Array.of(0),
  ]);
}

function resolver(
  addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS],
  records: readonly DnsSrvRecord[] = [],
): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly DnsSrvRecord[]> => Promise.resolve(records)),
  };
}

interface ScriptedTcpOptions {
  readonly response: Uint8Array;
  readonly failAddresses?: ReadonlySet<string>;
  readonly addresses?: string[];
  readonly ports?: number[];
  readonly hosts?: string[];
}

function scriptedTcp(options: ScriptedTcpOptions): TcpTransportDependencies {
  let clock = 0;
  return {
    createSocket(): TcpSocketAdapter {
      let connectListener = (): void => undefined;
      let dataListener: (data: Uint8Array) => void = (): void => undefined;
      let endListener = (): void => undefined;
      let errorListener: (error: Error) => void = (): void => undefined;
      let selectedAddress = "";
      return {
        onConnect(listener): void {
          connectListener = listener;
        },
        onData(listener): void {
          dataListener = listener;
        },
        onEnd(listener): void {
          endListener = listener;
        },
        onError(listener): void {
          errorListener = listener;
        },
        connect(port, address): void {
          selectedAddress = address;
          options.addresses?.push(address);
          options.ports?.push(port);
          queueMicrotask((): void => {
            if (options.failAddresses?.has(address) === true) {
              errorListener(new Error("Synthetic connection failure."));
            } else {
              connectListener();
            }
          });
        },
        write(data, completion): void {
          completion(undefined);
          options.hosts?.push(new TextDecoder().decode(data));
          if (options.failAddresses?.has(selectedAddress) !== true) {
            queueMicrotask((): void => {
              dataListener(options.response);
            });
          }
        },
        destroy(): void {
          endListener();
        },
      };
    },
    now(): number {
      clock += 8;
      return clock;
    },
  };
}

function successfulQuery(ports?: number[]): MinecraftQueryDependencies {
  return {
    converse(options) {
      ports?.push(options.target.port);
      const sessionId = new DataView(
        options.request.buffer,
        options.request.byteOffset + 3,
        4,
      ).getInt32(0);
      return Promise.resolve({
        responses: Object.freeze([Uint8Array.of(9), fullQueryResponse(sessionId)]),
        rttMs: 6,
        address: options.address,
        port: options.target.port,
      });
    },
  };
}

function failingQuery(error: UdpTransportError): MinecraftQueryDependencies {
  return {
    converse: () => Promise.reject(error),
  };
}

function dependencies(
  minecraftJava: TcpTransportDependencies,
  dns: DnsResolver = resolver(),
  minecraftQuery: MinecraftQueryDependencies = successfulQuery(),
  random: () => number = (): number => 0.5,
): QueryDependencies {
  let calls = 0;
  return {
    resolver: dns,
    minecraftJava,
    minecraftQuery,
    random,
    now(): number {
      calls += 1;
      return calls === 1 ? 100 : 125;
    },
  };
}

describe("Minecraft Java game profile", (): void => {
  it("merges typed SLP and Query results without flattening game-specific data", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "mc", host: "play.example.com" },
      dependencies(scriptedTcp({ response: SUCCESS_RESPONSE })),
    );

    expect(result).toEqual({
      ok: true,
      game: "minecraft-java",
      server: {
        map: "world",
        version: "Paper 1.21.8",
        players: { online: 7, max: 50 },
        queryRttMs: 8,
      },
      data: {
        motd: {
          plain: "QueryHost",
          html: '<span style="color:#ffaa00">Query</span><span style="color:#ffaa00;font-weight:bold">Host</span>',
        },
        protocolVersion: 772,
        software: { name: "Paper" },
        plugins: [{ name: "EssentialsX", version: "2.20.1" }, { name: "LuckPerms" }],
        players: ["Alex"],
      },
      sources: [
        { source: "minecraft-srv", status: "unsupported" },
        { source: "minecraft-slp", status: "ok", rttMs: 8 },
        { source: "minecraft-query", status: "ok", rttMs: 6 },
      ],
      warnings: [],
      partial: false,
      durationMs: 25,
    });
  });

  it("selects SRV targets by priority and deterministic weight", async (): Promise<void> => {
    const ports: number[] = [];
    const hosts: string[] = [];
    const dns = resolver(
      [PUBLIC_ADDRESS],
      [
        { name: "backup.example.com", port: 25_570, priority: 10, weight: 100 },
        { name: "light.example.com", port: 25_566, priority: 0, weight: 1 },
        { name: "heavy.example.com", port: 25_567, priority: 0, weight: 3 },
      ],
    );
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", mode: "summary" },
      dependencies(
        scriptedTcp({ response: SUCCESS_RESPONSE, ports, hosts }),
        dns,
        successfulQuery(),
        (): number => 0.9,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { srv: { host: "heavy.example.com", port: 25_567 } },
      sources: [
        { source: "minecraft-srv", status: "ok" },
        { source: "minecraft-slp", status: "ok" },
        { source: "minecraft-query", status: "not-requested" },
      ],
    });
    expect(ports).toEqual([25_567]);
    expect(hosts[0]).toContain("heavy.example.com");
  });

  it("falls back to the next SRV target and reports the target that answered", async (): Promise<void> => {
    const addresses: string[] = [];
    const dns: DnsResolver = {
      resolveAddresses(hostname): Promise<readonly DnsAddressRecord[]> {
        return Promise.resolve([
          hostname === "primary.example.com"
            ? { address: "1.1.1.1", family: 4 }
            : { address: "8.8.8.8", family: 4 },
        ]);
      },
      resolveSrv(): Promise<readonly DnsSrvRecord[]> {
        return Promise.resolve([
          { name: "primary.example.com", port: 25_565, priority: 0, weight: 1 },
          { name: "backup.example.com", port: 25_566, priority: 10, weight: 1 },
        ]);
      },
    };
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", mode: "summary" },
      dependencies(
        scriptedTcp({
          response: SUCCESS_RESPONSE,
          failAddresses: new Set(["1.1.1.1"]),
          addresses,
        }),
        dns,
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { srv: { host: "backup.example.com", port: 25_566 } },
    });
    expect(addresses).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("bypasses SRV for an explicit game port and keeps queryPort separate", async (): Promise<void> => {
    const tcpPorts: number[] = [];
    const queryPorts: number[] = [];
    const dns = resolver();
    const result = await queryWithDependencies(
      {
        game: "minecraft-java",
        host: "play.example.com",
        port: 25_600,
        queryPort: 25_700,
      },
      dependencies(
        scriptedTcp({ response: SUCCESS_RESPONSE, ports: tcpPorts }),
        dns,
        successfulQuery(queryPorts),
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.sources[0]).toEqual({ source: "minecraft-srv", status: "not-requested" });
    expect(dns.resolveSrv).not.toHaveBeenCalled();
    expect(tcpPorts).toEqual([25_600]);
    expect(queryPorts).toEqual([25_700]);
  });

  it("falls back across validated addresses and pins each TCP connection", async (): Promise<void> => {
    const addresses: string[] = [];
    const tcp = scriptedTcp({
      response: SUCCESS_RESPONSE,
      failAddresses: new Set(["1.1.1.1"]),
      addresses,
    });
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", mode: "summary" },
      dependencies(
        tcp,
        resolver([
          { address: "1.1.1.1", family: 4 },
          { address: "8.8.8.8", family: 4 },
        ]),
      ),
    );
    expect(result.ok).toBe(true);
    expect(addresses).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("caps the multiplied SRV and address fallback set per query", async (): Promise<void> => {
    const publicAddresses = Array.from({ length: 4 }, (_, index): DnsAddressRecord => ({
      address: `1.1.1.${String(index + 1)}`,
      family: 4,
    }));
    const records = Array.from({ length: 4 }, (_, index): DnsSrvRecord => ({
      name: "node.example.com",
      port: 25_565 + index,
      priority: index,
      weight: 1,
    }));
    const attemptedAddresses: string[] = [];
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", mode: "summary" },
      dependencies(
        scriptedTcp({
          response: SUCCESS_RESPONSE,
          failAddresses: new Set(publicAddresses.map((record) => record.address)),
          addresses: attemptedAddresses,
        }),
        resolver(publicAddresses, records),
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "CONNECTION_FAILED",
        message: "The query exceeded its outbound attempt limit.",
      },
    });
    expect(attemptedAddresses).toHaveLength(13);
  });

  it("returns partial SLP data when optional Query times out", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com" },
      dependencies(
        scriptedTcp({ response: SUCCESS_RESPONSE }),
        resolver(),
        failingQuery(new UdpTransportError("TIMEOUT")),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { protocolVersion: 772 },
      partial: true,
      sources: [
        { source: "minecraft-srv", status: "unsupported" },
        { source: "minecraft-slp", status: "ok" },
        { source: "minecraft-query", status: "timeout" },
      ],
      warnings: [{ code: "PARTIAL_RESULT" }, { code: "SOURCE_TIMEOUT", source: "minecraft-query" }],
    });
    if (result.ok && result.game === "minecraft-java") {
      expect(result.data.players).toBeUndefined();
      expect(result.data.plugins).toBeUndefined();
      expect(result.data.software).toBeUndefined();
    }
  });

  it("maps malformed SLP data into a stable required-source failure", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com" },
      dependencies(scriptedTcp({ response: Uint8Array.of(0x01, 0x01) })),
    );
    expect(result).toEqual({
      ok: false,
      game: "minecraft-java",
      error: {
        code: "MALFORMED_RESPONSE",
        message: "The Minecraft Java status response was malformed.",
        source: "minecraft-slp",
      },
      durationMs: 25,
      sources: [
        { source: "minecraft-srv", status: "unsupported" },
        { source: "minecraft-slp", status: "malformed" },
      ],
      warnings: [],
    });
  });
});
