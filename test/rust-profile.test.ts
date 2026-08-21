import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { queryWithDependencies, type QueryDependencies } from "../src/client.js";
import type { A2sExchangeDependencies } from "../src/protocols/a2s/network.js";
import type { DnsAddressRecord, DnsResolver } from "../src/target.js";
import {
  UdpTransportError,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../src/transports/udp.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });

async function fixture(name: string): Promise<Uint8Array> {
  const text = await readFile(new URL(`./fixtures/rust/${name}.hex`, import.meta.url), "utf8");
  const compact = text.replaceAll(/\s/gu, "");
  if (compact.length === 0 || compact.length % 2 !== 0 || /[^0-9a-f]/iu.test(compact)) {
    throw new Error(`Invalid Rust hex fixture: ${name}`);
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn(() => Promise.resolve(addresses)),
    resolveSrv: vi.fn(() => Promise.resolve([])),
  };
}

function clock(start: number, end: number): () => number {
  let calls = 0;
  return (): number => {
    calls += 1;
    return calls === 1 ? start : end;
  };
}

function packetType(options: UdpCollectionOptions): number {
  const type = options.request[4];
  if (type === undefined) {
    throw new Error("The A2S request is missing its type byte.");
  }
  return type;
}

function response(
  options: UdpCollectionOptions,
  data: Uint8Array,
  rttMs: number,
): UdpCollectionResult {
  return {
    datagrams: Object.freeze([data]),
    rttMs,
    address: options.address,
    port: options.target.port,
  };
}

async function successfulA2s(): Promise<A2sExchangeDependencies> {
  const [info, players, rules] = await Promise.all([
    fixture("info"),
    fixture("players"),
    fixture("rules"),
  ]);
  return {
    collect(options): Promise<UdpCollectionResult> {
      const type = packetType(options);
      if (type === 0x54) {
        return Promise.resolve(response(options, info, 8));
      }
      if (type === 0x55) {
        return Promise.resolve(response(options, players, 5));
      }
      if (type === 0x56) {
        return Promise.resolve(response(options, rules, 6));
      }
      return Promise.reject(new Error("Unexpected A2S request type."));
    },
  };
}

function dependencies(
  a2s: A2sExchangeDependencies,
  dns: DnsResolver = resolver(),
  now: () => number = clock(100, 125),
): QueryDependencies {
  return { resolver: dns, a2s, now };
}

describe("Rust game profile", (): void => {
  it("merges the full fixture into typed common and Rust-specific data", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "rust", host: "PLAY.EXAMPLE.COM." },
      dependencies(await successfulA2s()),
    );

    expect(result).toEqual({
      ok: true,
      game: "rust",
      server: {
        name: "QueryHost Rust Fixture",
        map: "Procedural Map",
        version: "2600",
        password: false,
        players: { online: 12, max: 100 },
        queryRttMs: 8,
      },
      data: {
        tags: ["mp100", "cp0", "weekly", "vanilla"],
        players: [
          { index: 0, name: "Alice", score: 10, durationSeconds: 123.5 },
          { index: 1, name: "Bob", score: -2, durationSeconds: 2.25 },
        ],
      },
      rawData: {
        rules: {
          hostname: "QueryHost Rust Fixture",
          "world.seed": "123456",
          "world.size": "4500",
          pve: "false",
        },
      },
      sources: [
        { source: "a2s-info", status: "ok", rttMs: 8 },
        { source: "a2s-player", status: "ok", rttMs: 5 },
        { source: "a2s-rules", status: "ok", rttMs: 6 },
      ],
      partial: false,
      warnings: [],
      durationMs: 25,
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok && result.game === "rust") {
      expect(Object.isFrozen(result.data.players)).toBe(true);
      expect(Object.isFrozen(result.rawData?.rules)).toBe(true);
    }
  });

  it("returns a successful partial result when Player times out", async (): Promise<void> => {
    const base = await successfulA2s();
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x55
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", mode: "full" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "rust",
      partial: true,
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "timeout" },
        { source: "a2s-rules", status: "ok" },
      ],
      warnings: [
        { code: "PARTIAL_RESULT" },
        { code: "PLAYER_LIST_UNAVAILABLE", source: "a2s-player" },
        { code: "SOURCE_TIMEOUT", source: "a2s-player" },
      ],
    });
    if (!result.ok || result.game !== "rust") {
      throw new Error("Expected a successful Rust result.");
    }
    expect(result.data.players).toBeUndefined();
    expect(result.rawData?.rules["world.seed"]).toBe("123456");
  });

  it("preserves confirmed-empty optional values", async (): Promise<void> => {
    const base = await successfulA2s();
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        const type = packetType(options);
        if (type === 0x55) {
          return Promise.resolve(
            response(options, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x44, 0), 2),
          );
        }
        if (type === 0x56) {
          return Promise.resolve(
            response(options, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x45, 0, 0), 3),
          );
        }
        return base.collect(options);
      },
    };

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com" },
      dependencies(a2s),
    );

    if (!result.ok || result.game !== "rust") {
      throw new Error("Expected a successful Rust result.");
    }
    expect(result.partial).toBe(false);
    expect(result.data.players).toEqual([]);
    expect(result.rawData?.rules).toEqual({});
  });

  it("skips optional network work in summary mode without marking the result partial", async (): Promise<void> => {
    const base = await successfulA2s();
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", mode: "summary" },
      dependencies({ collect }),
    );

    expect(collect).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      partial: false,
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "not-requested" },
        { source: "a2s-rules", status: "not-requested" },
      ],
      warnings: [],
    });
    if (!result.ok || result.game !== "rust") {
      throw new Error("Expected a successful Rust result.");
    }
    expect(result.data.tags).toEqual(["mp100", "cp0", "weekly", "vanilla"]);
    expect(result.data.players).toBeUndefined();
    expect(result.rawData).toBeUndefined();
  });

  it("returns a required-source failure with stable provenance", async (): Promise<void> => {
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return Promise.resolve(response(options, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0), 2));
      },
    };

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toEqual({
      ok: false,
      game: "rust",
      error: {
        code: "MALFORMED_RESPONSE",
        message: "The A2S response was malformed.",
        source: "a2s-info",
      },
      durationMs: 25,
      sources: [{ source: "a2s-info", status: "malformed" }],
      warnings: [],
    });
  });

  it("rejects unsafe targets before starting A2S", async (): Promise<void> => {
    const base = await successfulA2s();
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));
    const blocked = resolver([{ address: "127.0.0.1", family: 4 }]);

    const result = await queryWithDependencies(
      { game: "rust", host: "blocked.example" },
      dependencies({ collect }, blocked),
    );

    expect(collect).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      error: { code: "TARGET_BLOCKED" },
      sources: [],
    });
  });

  it("derives Rust query ports while preserving explicit queryPort precedence", async (): Promise<void> => {
    const base = await successfulA2s();
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };

    await queryWithDependencies(
      {
        game: "rust",
        host: "play.example.com",
        port: 28_015,
        queryPort: 30_000,
        mode: "summary",
      },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "rust", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "rust", host: "play.example.com", port: 29_015, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([30_000, 28_017, 29_017]);
  });

  it("falls back across validated addresses and pins optional work to the successful one", async (): Promise<void> => {
    const base = await successfulA2s();
    const addresses: string[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        addresses.push(options.address.address);
        if (packetType(options) === 0x54 && options.address.address === "1.1.1.1") {
          return Promise.reject(new UdpTransportError("CONNECTION_FAILED"));
        }
        return base.collect(options);
      },
    };
    const dns = resolver([
      { address: "1.1.1.1", family: 4 },
      { address: "8.8.8.8", family: 4 },
    ]);

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com" },
      dependencies(a2s, dns),
    );

    expect(result.ok).toBe(true);
    expect(addresses).toEqual(["1.1.1.1", "8.8.8.8", "8.8.8.8", "8.8.8.8"]);
  });

  it("returns unsupported profiles without DNS or network work", async (): Promise<void> => {
    const dns = resolver();
    const base = await successfulA2s();
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));

    const result = await queryWithDependencies(
      { game: "minecraft-bedrock", host: "play.example.com" },
      dependencies({ collect }, dns),
    );

    expect(dns.resolveAddresses).not.toHaveBeenCalled();
    expect(collect).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      game: "minecraft-bedrock",
      error: { code: "UNSUPPORTED_GAME" },
    });
  });

  it("maps pre-cancelled queries without resolving the target", async (): Promise<void> => {
    const controller = new AbortController();
    controller.abort();
    const dns = resolver();

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", signal: controller.signal },
      { resolver: dns, now: clock(10, 11) },
    );

    expect(dns.resolveAddresses).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      game: "rust",
      error: { code: "ABORTED" },
      durationMs: 1,
      sources: [],
    });
  });

  it("enforces the public global deadline when source work does not settle", async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      const a2s: A2sExchangeDependencies = {
        collect(): Promise<UdpCollectionResult> {
          return new Promise(() => undefined);
        },
      };
      const pending = queryWithDependencies(
        { game: "rust", host: "play.example.com", timeoutMs: 100 },
        dependencies(a2s, resolver(), clock(0, 100)),
      );

      await vi.advanceTimersByTimeAsync(100);

      await expect(pending).resolves.toMatchObject({
        ok: false,
        game: "rust",
        error: { code: "TIMEOUT" },
        sources: [{ source: "a2s-info", status: "timeout" }],
        durationMs: 100,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid public budgets without allocating network work", async (): Promise<void> => {
    const dns = resolver();
    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", timeoutMs: 30_001 },
      { resolver: dns, now: clock(10, 12) },
    );

    expect(dns.resolveAddresses).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" }, durationMs: 2 });
  });
});
