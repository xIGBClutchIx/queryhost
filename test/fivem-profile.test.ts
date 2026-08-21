import { describe, expect, it, vi } from "vitest";

import { queryWithDependencies, type QueryDependencies } from "../src/client.js";
import type { FiveMQueryDependencies } from "../src/protocols/fivem/query.js";
import type { QuerySourceName, QuerySourceStatus } from "../src/shared.js";
import type { DnsAddressRecord, DnsResolver } from "../src/target.js";
import {
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
} from "../src/transports/http.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const SUCCESS_BODIES: Readonly<Record<string, string>> = Object.freeze({
  "/info.json": JSON.stringify({
    server: "FXServer-master v1.0.0",
    enhancedHostSupport: true,
    resources: ["hardcap", "chat"],
    vars: { onesync_enabled: "true", sv_projectName: "QueryHost RP" },
  }),
  "/dynamic.json": JSON.stringify({
    hostname: "QueryHost FiveM",
    gametype: "Freeroam",
    mapname: "fivem-map-skater",
    clients: 1,
    sv_maxclients: "48",
  }),
  "/players.json": JSON.stringify([{ id: 7, name: "Ada", ping: 42 }]),
});

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function dependencies(
  fivem: FiveMQueryDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let nowCalls = 0;
  return {
    resolver: dns,
    fivem,
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
    return Promise.reject(new Error("Unexpected FiveM test path."));
  }
  return Promise.resolve(response(options, body));
}

function sourcePath(source: QuerySourceName): string {
  if (source === "fivem-info") {
    return "/info.json";
  }
  if (source === "fivem-dynamic") {
    return "/dynamic.json";
  }
  if (source === "fivem-players") {
    return "/players.json";
  }
  throw new Error("The test source is not a FiveM source.");
}

type Fault = "timeout" | "malformed" | "not-found" | "blocked" | "oversized";

const FAULT_STATUS: Readonly<Record<Fault, QuerySourceStatus>> = Object.freeze({
  timeout: "timeout",
  malformed: "malformed",
  "not-found": "unsupported",
  blocked: "blocked",
  oversized: "malformed",
});

function faultExchange(
  failedSource: QuerySourceName,
  fault: Fault,
): NonNullable<FiveMQueryDependencies["exchange"]> {
  return (options): Promise<FixedHttpExchangeResult> => {
    if (options.path !== sourcePath(failedSource)) {
      return successfulExchange(options);
    }
    if (fault === "timeout") {
      return Promise.reject(new HttpTransportError("TIMEOUT"));
    }
    if (fault === "oversized") {
      return Promise.reject(new HttpTransportError("RESPONSE_TOO_LARGE"));
    }
    if (fault === "malformed") {
      return Promise.resolve(response(options, "{"));
    }
    if (fault === "not-found") {
      return Promise.resolve(response(options, "not found", 404));
    }
    return Promise.resolve(response(options, "Nope.", 403));
  };
}

describe("FiveM game profile", (): void => {
  it("runs all fixed endpoints concurrently and merges typed facts", async (): Promise<void> => {
    const started = new Set<string>();
    const ports = new Set<number>();
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const exchange: FiveMQueryDependencies["exchange"] = async (
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
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange }),
    );

    expect(started).toEqual(new Set(["/info.json", "/dynamic.json", "/players.json"]));
    expect(ports).toEqual(new Set([30_120]));
    expect(result).toEqual({
      ok: true,
      game: "fivem",
      server: {
        name: "QueryHost FiveM",
        map: "fivem-map-skater",
        version: "FXServer-master v1.0.0",
        players: { online: 1, max: 48 },
        queryRttMs: 13,
      },
      data: {
        resources: ["hardcap", "chat"],
        variables: { onesync_enabled: "true", sv_projectName: "QueryHost RP" },
        players: [{ id: 7, name: "Ada", ping: 42 }],
        gameType: "Freeroam",
        oneSyncEnabled: true,
        enhancedHostSupport: true,
      },
      sources: [
        { source: "fivem-info", status: "ok", rttMs: 11 },
        { source: "fivem-dynamic", status: "ok", rttMs: 13 },
        { source: "fivem-players", status: "ok", rttMs: 17 },
      ],
      warnings: [],
      partial: false,
      durationMs: 30,
    });
  });

  it.each(
    (["fivem-info", "fivem-dynamic", "fivem-players"] as const).flatMap((source) =>
      (["timeout", "malformed", "not-found", "blocked", "oversized"] as const).map(
        (fault) => [source, fault] as const,
      ),
    ),
  )("reports %s %s without inventing endpoint data", async (source, fault): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange: faultExchange(source, fault) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected a partial FiveM result.");
    }
    expect(result.partial).toBe(true);
    expect(result.sources).toContainEqual({ source, status: FAULT_STATUS[fault] });
    if (source === "fivem-info") {
      expect(result.data).not.toHaveProperty("resources");
      expect(result.data).not.toHaveProperty("variables");
    } else if (source === "fivem-players") {
      expect(result.data).not.toHaveProperty("players");
      expect(result.warnings).toContainEqual({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: "The FiveM player list is unavailable.",
        source: "fivem-players",
      });
    } else {
      expect(result.server).not.toHaveProperty("name");
      expect(result.server).not.toHaveProperty("players");
    }
  });

  it("distinguishes confirmed empty collections from unavailable endpoints", async (): Promise<void> => {
    const emptyExchange: FiveMQueryDependencies["exchange"] = (options) => {
      if (options.path === "/info.json") {
        return Promise.resolve(response(options, '{"resources":[],"vars":{}}'));
      }
      if (options.path === "/players.json") {
        return Promise.resolve(response(options, "[]"));
      }
      return successfulExchange(options);
    };
    const confirmed = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange: emptyExchange }),
    );
    expect(confirmed.ok && confirmed.data).toMatchObject({
      resources: [],
      variables: {},
      players: [],
    });

    const unavailable = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange: faultExchange("fivem-players", "blocked") }),
    );
    expect(unavailable.ok).toBe(true);
    if (unavailable.ok) {
      expect(unavailable.data).not.toHaveProperty("players");
    }
  });

  it("rejects JSON that exceeds the structural depth budget", async (): Promise<void> => {
    const deeplyNested = `${"[".repeat(34)}null${"]".repeat(34)}`;
    const exchange: FiveMQueryDependencies["exchange"] = (options) =>
      options.path === "/info.json"
        ? Promise.resolve(response(options, deeplyNested))
        : successfulExchange(options);
    const result = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange }),
    );
    expect(result.ok && result.sources).toContainEqual({
      source: "fivem-info",
      status: "malformed",
    });
  });

  it("ignores a large bounded server icon instead of rejecting the info document", async (): Promise<void> => {
    const exchange: FiveMQueryDependencies["exchange"] = (options) => {
      if (options.path !== "/info.json") {
        return successfulExchange(options);
      }
      return Promise.resolve(
        response(
          options,
          JSON.stringify({
            icon: "a".repeat(65_536),
            server: "FXServer-master v1.0.0",
            resources: ["hardcap"],
            vars: {},
          }),
        ),
      );
    };
    const result = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange }),
    );
    expect(result.ok && result.sources).toContainEqual({
      source: "fivem-info",
      status: "ok",
      rttMs: 11,
    });
  });

  it("uses only dynamic.json in summary mode and reports skipped sources", async (): Promise<void> => {
    const paths: string[] = [];
    const ports: number[] = [];
    const exchange: FiveMQueryDependencies["exchange"] = (options) => {
      paths.push(options.path);
      ports.push(options.target.port);
      return successfulExchange(options);
    };
    const result = await queryWithDependencies(
      {
        game: "five-m",
        host: "play.example.com",
        port: 30_121,
        queryPort: 30_122,
        mode: "summary",
      },
      dependencies({ exchange }),
    );
    expect(paths).toEqual(["/dynamic.json"]);
    expect(ports).toEqual([30_122]);
    expect(result.ok && result.sources).toEqual([
      { source: "fivem-info", status: "not-requested" },
      { source: "fivem-dynamic", status: "ok", rttMs: 13 },
      { source: "fivem-players", status: "not-requested" },
    ]);
  });

  it("fails only after every requested source is unavailable", async (): Promise<void> => {
    const exchange: FiveMQueryDependencies["exchange"] = (options) =>
      Promise.resolve(response(options, "Nope", 403));
    const result = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange }),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "fivem",
      error: {
        code: "CONNECTION_FAILED",
        message: "The FiveM endpoint blocked this request.",
        source: "fivem-info",
      },
      sources: [
        { source: "fivem-info", status: "blocked" },
        { source: "fivem-dynamic", status: "blocked" },
        { source: "fivem-players", status: "blocked" },
      ],
    });
  });

  it("does not merge endpoint results across different pinned addresses", async (): Promise<void> => {
    const first = Object.freeze({ address: "1.1.1.1", family: 4 as const });
    const second = Object.freeze({ address: "8.8.8.8", family: 4 as const });
    const calls: string[] = [];
    const exchange: FiveMQueryDependencies["exchange"] = (options) => {
      calls.push(`${options.address.address}${options.path}`);
      if (options.address.address === first.address) {
        return Promise.reject(new HttpTransportError("CONNECTION_FAILED"));
      }
      return successfulExchange(options);
    };
    const result = await queryWithDependencies(
      { game: "fivem", host: "play.example.com" },
      dependencies({ exchange }, resolver([first, second])),
    );
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(6);
    expect(calls.slice(0, 3).every((call) => call.startsWith(first.address))).toBe(true);
    expect(calls.slice(3).every((call) => call.startsWith(second.address))).toBe(true);
  });
});
