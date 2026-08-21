import { describe, expect, it } from "vitest";

import { queryWithDependencies, type QueryDependencies } from "../src/client.js";
import { encodeVarInt } from "../src/protocols/minecraft-java/varint.js";
import type { DnsAddressRecord, DnsResolver } from "../src/target.js";
import type { TcpSocketAdapter, TcpTransportDependencies } from "../src/transports/tcp.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
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

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: (): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses),
    resolveSrv: (): Promise<readonly []> => Promise.resolve([]),
  };
}

interface ScriptedTcpOptions {
  readonly response: Uint8Array;
  readonly failAddresses?: ReadonlySet<string>;
  readonly addresses?: string[];
  readonly ports?: number[];
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
        write(_data, completion): void {
          completion(undefined);
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

function dependencies(
  minecraftJava: TcpTransportDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let calls = 0;
  return {
    resolver: dns,
    minecraftJava,
    now(): number {
      calls += 1;
      return calls === 1 ? 100 : 125;
    },
  };
}

describe("Minecraft Java game profile", (): void => {
  it("returns a typed SLP result with canonical alias identity and provenance", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "mc", host: "play.example.com" },
      dependencies(scriptedTcp({ response: SUCCESS_RESPONSE })),
    );

    expect(result).toEqual({
      ok: true,
      game: "minecraft-java",
      server: {
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
      },
      sources: [{ source: "minecraft-slp", status: "ok", rttMs: 8 }],
      warnings: [],
      partial: false,
      durationMs: 25,
    });
  });

  it("uses TCP 25565 by default and honors explicit port precedence", async (): Promise<void> => {
    const ports: number[] = [];
    const tcp = scriptedTcp({ response: SUCCESS_RESPONSE, ports });
    await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com" },
      dependencies(tcp),
    );
    await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", port: 25_600 },
      dependencies(tcp),
    );
    await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com", queryPort: 25_700 },
      dependencies(tcp),
    );
    expect(ports).toEqual([25_565, 25_600, 25_700]);
  });

  it("falls back across validated addresses and pins each TCP connection", async (): Promise<void> => {
    const addresses: string[] = [];
    const tcp = scriptedTcp({
      response: SUCCESS_RESPONSE,
      failAddresses: new Set(["1.1.1.1"]),
      addresses,
    });
    const result = await queryWithDependencies(
      { game: "minecraft-java", host: "play.example.com" },
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
      sources: [{ source: "minecraft-slp", status: "malformed" }],
      warnings: [],
    });
  });
});
