import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { EcoQueryDependencies } from "../../src/protocols/eco/frontpage.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import {
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
} from "../../src/transports/http.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const SECOND_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.35", family: 4 });
const FIXTURE = readFileSync(new URL("../fixtures/eco/frontpage.json", import.meta.url), "utf8");

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function dependencies(eco: EcoQueryDependencies, dns: DnsResolver = resolver()): QueryDependencies {
  let nowCalls = 0;
  return {
    resolver: dns,
    eco,
    now(): number {
      nowCalls += 1;
      return nowCalls === 1 ? 100 : 130;
    },
  };
}

function response(
  options: FixedHttpExchangeOptions,
  body: string,
  statusCode = 200,
): FixedHttpExchangeResult {
  return Object.freeze({
    statusCode,
    data: new TextEncoder().encode(body),
    rttMs: 12,
    address: options.address,
    port: options.target.port,
  });
}

describe("Eco game profile", (): void => {
  it("queries the fixed status page on the web port and normalizes its facts", async (): Promise<void> => {
    const requests: FixedHttpExchangeOptions[] = [];
    const exchange: EcoQueryDependencies["exchange"] = (options) => {
      requests.push(options);
      return Promise.resolve(response(options, FIXTURE));
    };
    const result = await queryWithDependencies(
      { game: "eco", host: "play.example.com" },
      dependencies({ exchange }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      protocol: "http",
      path: "/frontpage",
      target: { hostname: "play.example.com", port: 3001 },
      address: PUBLIC_ADDRESS,
    });
    expect(requests[0]?.tlsCertificatePolicy).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      game: "eco",
      server: {
        name: "Green Valley | Vanilla",
        version: "0.11.1.5 beta release-786",
        password: false,
        players: { online: 2 },
        queryRttMs: 12,
      },
      data: {
        players: ["Ada", "Linus"],
        detailedDescription: "Collaborative world, meteor on.",
        totalPlayers: 41,
        activeAndOnlinePlayers: 9,
        peakActivePlayers: 14,
        maxActivePlayers: 0,
        adminOnline: false,
        category: "Beginner",
        language: "English",
        worldSize: "0.52 km²",
        economyDescription: "312 trades",
        skillSpecialization: "Default",
        playtimes: "",
        discordAddress: "",
        joinUrl: "eco://connect/play.example.com:3000",
        access: "Public",
        gamePort: 3000,
        webPort: 3001,
        external: true,
        lan: false,
        paused: false,
        meteor: true,
        timeSinceStartSeconds: 432000.5,
        timeLeftSeconds: 2160000.25,
        animals: 15234,
        plants: 902113,
        laws: 7,
        limitingHours: false,
        exhaustionAfterHours: 0,
      },
      rawData: {
        description: "<color=#7CFC00><b>Green Valley</b></color> | <size=80%>Vanilla</size>",
        detailedDescription: "<i>Collaborative</i> world, meteor on.",
      },
      sources: [{ source: "eco-frontpage", status: "ok", rttMs: 12 }],
      partial: false,
      warnings: [],
      durationMs: 30,
    });
  });

  it("keeps the web-port offset for custom game ports and honors an explicit query port", async (): Promise<void> => {
    const ports: number[] = [];
    const exchange: EcoQueryDependencies["exchange"] = (options) => {
      ports.push(options.target.port);
      return Promise.resolve(response(options, '{"Info":{}}'));
    };
    await queryWithDependencies(
      { game: "eco", host: "play.example.com", port: 4000 },
      dependencies({ exchange }),
    );
    await queryWithDependencies(
      { game: "eco", host: "play.example.com", port: 4000, queryPort: 8080 },
      dependencies({ exchange }),
    );
    expect(ports).toEqual([4001, 8080]);
  });

  it("reports a liveness-only page without invented fields", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "eco", host: "play.example.com" },
      dependencies({
        exchange: (options) => Promise.resolve(response(options, '{"Info":{}}')),
      }),
    );
    expect(result).toMatchObject({ ok: true, server: { queryRttMs: 12 }, data: {}, rawData: {} });
    expect(result.ok && result.server.players).toBeUndefined();
  });

  it("falls back to the next validated address", async (): Promise<void> => {
    const tried: string[] = [];
    const exchange: EcoQueryDependencies["exchange"] = (options) => {
      tried.push(options.address.address);
      return options.address.address === PUBLIC_ADDRESS.address
        ? Promise.reject(new HttpTransportError("CONNECTION_FAILED"))
        : Promise.resolve(response(options, FIXTURE));
    };
    const result = await queryWithDependencies(
      { game: "eco", host: "play.example.com" },
      dependencies({ exchange }, resolver([PUBLIC_ADDRESS, SECOND_ADDRESS])),
    );
    expect(result.ok).toBe(true);
    expect(tried).toEqual([PUBLIC_ADDRESS.address, SECOND_ADDRESS.address]);
  });

  it.each([
    [
      "a transport timeout",
      (): Promise<FixedHttpExchangeResult> => Promise.reject(new HttpTransportError("TIMEOUT")),
      "TIMEOUT",
      "timeout",
    ],
    [
      "an oversized page",
      (): Promise<FixedHttpExchangeResult> =>
        Promise.reject(new HttpTransportError("RESPONSE_TOO_LARGE")),
      "RESPONSE_TOO_LARGE",
      "malformed",
    ],
    [
      "malformed JSON",
      (options: FixedHttpExchangeOptions): Promise<FixedHttpExchangeResult> =>
        Promise.resolve(response(options, "{")),
      "MALFORMED_RESPONSE",
      "malformed",
    ],
    [
      "an HTTP error status",
      (options: FixedHttpExchangeOptions): Promise<FixedHttpExchangeResult> =>
        Promise.resolve(response(options, "Not Found", 404)),
      "CONNECTION_FAILED",
      "failed",
    ],
  ] as const)(
    "fails with a stable error for %s",
    async (_label, exchange, code, status): Promise<void> => {
      const result = await queryWithDependencies(
        { game: "eco", host: "play.example.com" },
        dependencies({ exchange }),
      );
      expect(result).toMatchObject({
        ok: false,
        game: "eco",
        error: { code, source: "eco-frontpage" },
        sources: [{ source: "eco-frontpage", status }],
      });
    },
  );
});
