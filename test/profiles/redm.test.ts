import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { CfxQueryDependencies } from "../../src/protocols/cfx/query.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import type {
  FixedHttpExchangeOptions,
  FixedHttpExchangeResult,
} from "../../src/transports/http.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/redm/${name}`, import.meta.url), "utf8");
}

const SUCCESS_BODIES: Readonly<Record<string, string>> = Object.freeze({
  "/info.json": fixture("info.json"),
  "/dynamic.json": fixture("dynamic.json"),
  "/players.json": fixture("players.json"),
});

function resolver(): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> =>
      Promise.resolve([PUBLIC_ADDRESS]),
    ),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function dependencies(redm: CfxQueryDependencies): QueryDependencies {
  let nowCalls = 0;
  return {
    resolver: resolver(),
    redm,
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
    rttMs: options.path === "/info.json" ? 11 : options.path === "/dynamic.json" ? 13 : 17,
    address: options.address,
    port: options.target.port,
  });
}

function successfulExchange(options: FixedHttpExchangeOptions): Promise<FixedHttpExchangeResult> {
  const body = SUCCESS_BODIES[options.path];
  if (body === undefined) {
    return Promise.reject(new Error("Unexpected RedM test path."));
  }
  return Promise.resolve(response(options, body));
}

describe("RedM game profile", (): void => {
  it("dispatches all shared Cfx endpoints concurrently on the default port", async (): Promise<void> => {
    const started = new Set<string>();
    const ports = new Set<number>();
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const exchange: CfxQueryDependencies["exchange"] = async (
      options,
    ): Promise<FixedHttpExchangeResult> => {
      started.add(options.path);
      ports.add(options.target.port);
      if (started.size === 3) {
        release?.();
      }
      await barrier;
      return successfulExchange(options);
    };

    const result = await queryWithDependencies(
      { game: "redm", host: "play.example.com" },
      dependencies({ exchange }),
    );

    expect(started).toEqual(new Set(["/info.json", "/dynamic.json", "/players.json"]));
    expect(ports).toEqual(new Set([30_120]));
    expect(result).toEqual({
      ok: true,
      game: "redm",
      server: {
        name: "QueryHost RedM",
        map: "redm-map-one",
        version: "FXServer-master v1.0.0",
        players: { online: 2, max: 32 },
        queryRttMs: 13,
      },
      data: {
        resources: ["mapmanager", "rdr3_spawnmanager"],
        variables: {
          gamename: "rdr3",
          onesync_enabled: "true",
          sv_projectName: "QueryHost Frontier",
        },
        players: [
          { id: 3, name: "Abigail", ping: 37 },
          { id: 9, name: "Charles", ping: 51 },
        ],
        gameType: "Freeroam",
        oneSyncEnabled: true,
        enhancedHostSupport: true,
      },
      sources: [
        { source: "redm-info", status: "ok", rttMs: 11 },
        { source: "redm-dynamic", status: "ok", rttMs: 13 },
        { source: "redm-players", status: "ok", rttMs: 17 },
      ],
      warnings: [],
      partial: false,
      durationMs: 30,
    });
  });

  it("uses only dynamic.json in summary mode and preserves RedM provenance", async (): Promise<void> => {
    const paths: string[] = [];
    const result = await queryWithDependencies(
      { game: "red-m", host: "play.example.com", mode: "summary" },
      dependencies({
        exchange(options): Promise<FixedHttpExchangeResult> {
          paths.push(options.path);
          return successfulExchange(options);
        },
      }),
    );

    expect(paths).toEqual(["/dynamic.json"]);
    expect(result.ok && result.sources).toEqual([
      { source: "redm-info", status: "not-requested" },
      { source: "redm-dynamic", status: "ok", rttMs: 13 },
      { source: "redm-players", status: "not-requested" },
    ]);
  });

  it("keeps confirmed empty RedM collections distinct from unavailable sources", async (): Promise<void> => {
    const confirmed = await queryWithDependencies(
      { game: "redm", host: "play.example.com" },
      dependencies({
        exchange(options): Promise<FixedHttpExchangeResult> {
          if (options.path === "/info.json") {
            return Promise.resolve(response(options, '{"resources":[],"vars":{}}'));
          }
          if (options.path === "/players.json") {
            return Promise.resolve(response(options, "[]"));
          }
          return successfulExchange(options);
        },
      }),
    );

    expect(confirmed.ok && confirmed.data).toMatchObject({
      resources: [],
      variables: {},
      players: [],
    });

    const unavailable = await queryWithDependencies(
      { game: "redm", host: "play.example.com" },
      dependencies({
        exchange(options): Promise<FixedHttpExchangeResult> {
          return options.path === "/players.json"
            ? Promise.resolve(response(options, "Nope.", 403))
            : successfulExchange(options);
        },
      }),
    );
    expect(unavailable.ok).toBe(true);
    if (unavailable.ok) {
      expect(unavailable.data).not.toHaveProperty("players");
      expect(unavailable.warnings).toContainEqual({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: "The RedM player list is unavailable.",
        source: "redm-players",
      });
    }
  });

  it("returns stable RedM errors when every endpoint is blocked", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "redm", host: "play.example.com" },
      dependencies({
        exchange(options): Promise<FixedHttpExchangeResult> {
          return Promise.resolve(response(options, "Nope.", 403));
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "redm",
      error: {
        code: "CONNECTION_FAILED",
        message: "The RedM endpoint blocked this request.",
        source: "redm-info",
      },
      sources: [
        { source: "redm-info", status: "blocked" },
        { source: "redm-dynamic", status: "blocked" },
        { source: "redm-players", status: "blocked" },
      ],
    });
  });
});
