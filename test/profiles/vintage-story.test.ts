import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import type { TcpSocketAdapter, TcpTransportDependencies } from "../../src/transports/tcp.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });

async function fixture(name: string): Promise<Uint8Array> {
  const source = await readFile(
    new URL(`../fixtures/vintage-story/${name}.hex`, import.meta.url),
    "utf8",
  );
  return Uint8Array.from(Buffer.from(source.trim(), "hex"));
}

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function scriptedTcp(
  response: Uint8Array,
  observed: { addresses: string[]; ports: number[]; requests: string[] },
  failAddresses: ReadonlySet<string> = new Set(),
): TcpTransportDependencies {
  let clock = 0;
  return {
    createSocket(): TcpSocketAdapter {
      let connectListener = (): void => undefined;
      let dataListener: (data: Uint8Array) => void = (): void => undefined;
      let errorListener: (error: Error) => void = (): void => undefined;
      let selectedAddress = "";
      return {
        onConnect(listener): void {
          connectListener = listener;
        },
        onData(listener): void {
          dataListener = listener;
        },
        onEnd(): void {},
        onError(listener): void {
          errorListener = listener;
        },
        connect(port, address): void {
          selectedAddress = address;
          observed.addresses.push(address);
          observed.ports.push(port);
          queueMicrotask((): void => {
            if (failAddresses.has(address)) {
              errorListener(new Error("Synthetic connection failure."));
            } else {
              connectListener();
            }
          });
        },
        write(data, completion): void {
          observed.requests.push(Buffer.from(data).toString("hex"));
          completion(undefined);
          if (!failAddresses.has(selectedAddress)) {
            queueMicrotask((): void => {
              dataListener(response);
            });
          }
        },
        destroy(): void {},
      };
    },
    now(): number {
      clock += 7;
      return clock;
    },
  };
}

function dependencies(
  vintageStory: TcpTransportDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let calls = 0;
  return {
    resolver: dns,
    vintageStory,
    now(): number {
      calls += 1;
      return calls === 1 ? 100 : 125;
    },
  };
}

describe("Vintage Story game profile", (): void => {
  it("returns stock liveness without fabricating server-list metadata", async (): Promise<void> => {
    const observed = { addresses: [] as string[], ports: [] as number[], requests: [] as string[] };
    const result = await queryWithDependencies(
      { game: "vs", host: "play.example.com" },
      dependencies(scriptedTcp(await fixture("query-complete"), observed)),
    );

    expect(result).toEqual({
      ok: true,
      game: "vintage-story",
      server: { queryRttMs: 7 },
      data: { response: "liveness" },
      sources: [{ source: "vintage-story-query", status: "ok", rttMs: 7 }],
      warnings: [],
      partial: false,
      durationMs: 25,
    });
    expect(observed.ports).toEqual([42_420]);
    expect(observed.requests).toEqual(["00000004080f5200"]);
  });

  it("maps a richer compatible answer and honors a custom game port", async (): Promise<void> => {
    const observed = { addresses: [] as string[], ports: [] as number[], requests: [] as string[] };
    const result = await queryWithDependencies(
      { game: "vintage-story", host: "play.example.com", port: 42_421 },
      dependencies(scriptedTcp(await fixture("query-answer"), observed)),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "vintage-story",
      server: {
        name: "Temporal Haven",
        version: "1.22.7",
        password: true,
        players: { online: 3, max: 16 },
      },
      data: { response: "status", motd: "Welcome", gameMode: "survival" },
      partial: false,
    });
    expect(observed.ports).toEqual([42_421]);
  });

  it("falls back only across addresses from the pinned target", async (): Promise<void> => {
    const observed = { addresses: [] as string[], ports: [] as number[], requests: [] as string[] };
    const result = await queryWithDependencies(
      { game: "vintagestory", host: "play.example.com" },
      dependencies(
        scriptedTcp(await fixture("query-complete"), observed, new Set(["1.1.1.1"])),
        resolver([
          { address: "1.1.1.1", family: 4 },
          { address: "8.8.8.8", family: 4 },
        ]),
      ),
    );

    expect(result.ok).toBe(true);
    expect(observed.addresses).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("maps malformed required answers to stable source-attributed failures", async (): Promise<void> => {
    const observed = { addresses: [] as string[], ports: [] as number[], requests: [] as string[] };
    const result = await queryWithDependencies(
      { game: "vintage-story", host: "play.example.com" },
      dependencies(scriptedTcp(Uint8Array.of(0, 0, 0, 1, 0), observed)),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "vintage-story",
      error: { code: "MALFORMED_RESPONSE", source: "vintage-story-query" },
      sources: [{ source: "vintage-story-query", status: "malformed" }],
      warnings: [],
    });
  });
});
