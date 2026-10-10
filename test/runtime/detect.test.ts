import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { DetectProbe, DetectProtocol } from "../../src/contracts/detect.js";
import { GAME_IDS, GAME_REGISTRY } from "../../src/contracts/registry.js";
import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { QueryDependencies } from "../../src/runtime/client.js";
import { conventionalQueryPort } from "../../src/runtime/client.js";
import { detectWithDependencies, planProbes } from "../../src/runtime/detect.js";
import type { ExecutionScope } from "../../src/runtime/execution.js";
import {
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
} from "../../src/transports/http.js";
import type { TcpSocketAdapter, TcpTransportDependencies } from "../../src/transports/tcp.js";
import {
  UdpTransportError,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../../src/transports/udp.js";
import { sourceInfoPacket } from "../helpers/a2s-packets.js";
import { packetType } from "../helpers/a2s-profile.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });

type Attempt = `${DetectProtocol}@${number}`;

type A2sAnswer = (options: UdpCollectionOptions) => Promise<UdpCollectionResult> | undefined;
type CfxAnswer = (
  options: FixedHttpExchangeOptions,
) => Promise<FixedHttpExchangeResult> | undefined;

/** What each probed destination does; anything not listed refuses the connection. */
interface Network {
  readonly a2s?: A2sAnswer;
  readonly cfx?: CfxAnswer;
  readonly vintageStory?: Uint8Array;
  /** Leaves every unanswered destination silent until its query is cancelled. */
  readonly silent?: boolean;
}

interface Harness {
  readonly dependencies: QueryDependencies;
  readonly attempts: Attempt[];
  readonly resolver: DnsResolver;
}

function resolver(addresses: () => Promise<readonly DnsAddressRecord[]>): DnsResolver {
  return {
    resolveAddresses: vi.fn(addresses),
    resolveSrv: vi.fn(() => Promise.resolve([])),
  };
}

function unanswered<T>(
  scope: ExecutionScope,
  silent: boolean,
  error: (code: "ABORTED" | "CONNECTION_FAILED") => Error,
): Promise<T> {
  if (!silent) {
    return Promise.reject(error("CONNECTION_FAILED"));
  }
  return new Promise((_resolve, reject) => {
    scope.signal.addEventListener("abort", () => {
      reject(error("ABORTED"));
    });
  });
}

const udpError = (code: "ABORTED" | "CONNECTION_FAILED"): Error => new UdpTransportError(code);
const httpError = (code: "ABORTED" | "CONNECTION_FAILED"): Error => new HttpTransportError(code);

function tcp(
  protocol: DetectProtocol,
  attempts: Attempt[],
  response: Uint8Array | undefined,
  silent: boolean,
): TcpTransportDependencies {
  return {
    createSocket(): TcpSocketAdapter {
      let connected = (): void => undefined;
      let data: (bytes: Uint8Array) => void = (): void => undefined;
      let failed: (error: Error) => void = (): void => undefined;
      return {
        onConnect(listener): void {
          connected = listener;
        },
        onData(listener): void {
          data = listener;
        },
        onEnd(): void {},
        onError(listener): void {
          failed = listener;
        },
        connect(port): void {
          attempts.push(`${protocol}@${port}`);
          // A silent destination never connects; the query's own cancellation closes it.
          if (response === undefined && silent) {
            return;
          }
          queueMicrotask(() => {
            if (response === undefined) {
              failed(new Error("Synthetic refusal."));
            } else {
              connected();
            }
          });
        },
        write(_bytes, completion): void {
          completion(undefined);
          if (response !== undefined) {
            queueMicrotask(() => {
              data(response);
            });
          }
        },
        destroy(): void {},
      };
    },
    now: (): number => 0,
  };
}

function harness(network: Network = {}, addresses = [PUBLIC_ADDRESS]): Harness {
  const attempts: Attempt[] = [];
  const silent = network.silent === true;
  const dns = resolver(() => Promise.resolve(addresses));
  const http =
    (protocol: DetectProtocol) =>
    (options: FixedHttpExchangeOptions): Promise<FixedHttpExchangeResult> => {
      attempts.push(`${protocol}@${options.target.port}`);
      const answer = protocol === "cfx" ? network.cfx?.(options) : undefined;
      return answer ?? unanswered(options.scope, silent, httpError);
    };
  const cfx = { exchange: http("cfx") };
  let clock = 0;
  return {
    attempts,
    resolver: dns,
    dependencies: {
      resolver: dns,
      a2s: {
        collect(options): Promise<UdpCollectionResult> {
          attempts.push(`a2s@${options.target.port}`);
          return network.a2s?.(options) ?? unanswered(options.scope, silent, udpError);
        },
      },
      minecraftJava: tcp("minecraft-java", attempts, undefined, silent),
      minecraftQuery: {
        converse: (options) => unanswered(options.scope, silent, udpError),
      },
      minecraftBedrock: {
        exchange(options) {
          attempts.push(`minecraft-bedrock@${options.target.port}`);
          return unanswered(options.scope, silent, udpError);
        },
      },
      fivem: cfx,
      redm: cfx,
      satisfactory: {
        udpExchange(options) {
          attempts.push(`satisfactory@${options.target.port}`);
          return unanswered(options.scope, silent, udpError);
        },
        httpExchange: (options) => unanswered(options.scope, silent, httpError),
      },
      vintageStory: tcp("vintage-story", attempts, network.vintageStory, silent),
      eco: { exchange: http("eco") },
      now(): number {
        clock += 1;
        return clock;
      },
    },
  };
}

/** Answers A2S Info on one port only; Player and Rules stay unanswered. */
function a2sInfoOn(port: number, info: Uint8Array): A2sAnswer {
  return (options) =>
    options.target.port === port && packetType(options) === 0x54
      ? Promise.resolve({
          datagrams: [info],
          rttMs: 4,
          address: options.address,
          port: options.target.port,
        })
      : undefined;
}

async function fixture(path: string): Promise<string> {
  return readFile(new URL(`../fixtures/${path}`, import.meta.url), "utf8");
}

async function hexFixture(path: string): Promise<Uint8Array> {
  return Uint8Array.from(Buffer.from((await fixture(path)).replaceAll(/\s/gu, ""), "hex"));
}

function cfxServing(bodies: Readonly<Record<string, string>>): CfxAnswer {
  return (options) => {
    const body = bodies[options.path];
    return body === undefined
      ? undefined
      : Promise.resolve({
          statusCode: 200,
          data: new TextEncoder().encode(body),
          rttMs: 6,
          address: options.address,
          port: options.target.port,
        });
  };
}

function statuses(probes: readonly DetectProbe[]): readonly string[] {
  return probes.map(({ protocol, port, status }) => `${protocol}@${port}:${status}`);
}

describe("detection probe plan", (): void => {
  it("covers every game's conventional query destination when no port is given", (): void => {
    const plan = planProbes(undefined).map(({ protocol, port }) => `${protocol}@${port}`);

    for (const game of GAME_IDS) {
      const definition = GAME_REGISTRY[game];
      if (definition.defaultPort === undefined) {
        continue;
      }
      const protocol = definition.protocol === "a2s-unreal" ? "a2s" : definition.protocol;
      expect(plan).toContain(
        `${protocol}@${conventionalQueryPort(definition, definition.defaultPort)}`,
      );
    }
    expect(new Set(plan).size).toBe(plan.length);
    // The most shared A2S port leads, and every protocol is asked once before any is asked twice.
    expect(plan.slice(0, 7)).toEqual([
      "a2s@27015",
      "cfx@30120",
      "minecraft-java@25565",
      "minecraft-bedrock@19132",
      "satisfactory@7777",
      "vintage-story@42420",
      "eco@3001",
    ]);
  });

  it("leads with the game whose convention the given port matches", (): void => {
    expect(planProbes(25_565)[0]).toMatchObject({ protocol: "minecraft-java", port: 25_565 });
    expect(planProbes(28_015)[0]).toMatchObject({ protocol: "a2s", port: 28_017 });
    expect(planProbes(2456)[0]).toMatchObject({ protocol: "a2s", port: 2457 });
    expect(planProbes(3000)[0]).toMatchObject({ protocol: "eco", port: 3001 });
  });

  it("asks every conventional destination before guessing other protocols on the port", (): void => {
    const pairs = planProbes(7777).map(({ protocol, port }) => `${protocol}@${port}`);

    // ARK and the other fixed-port games, Satisfactory, then VEIN's game port + 1.
    expect(pairs.slice(0, 3)).toEqual(["a2s@27015", "satisfactory@7777", "a2s@7778"]);
    expect(pairs.indexOf("minecraft-java@7777")).toBeGreaterThan(2);
  });

  it("keeps fixed query ports as candidates for a custom game port", (): void => {
    const pairs = planProbes(9000).map(({ protocol, port }) => `${protocol}@${port}`);

    // Palworld and Don't Starve Together keep 27015 and 27016 whatever their game port.
    expect(pairs).toContain("a2s@27015");
    expect(pairs).toContain("a2s@27016");
  });

  it("tries the given port itself with every protocol", (): void => {
    const probes = planProbes(40_000);
    const direct = probes.filter(({ port }) => port === 40_000).map(({ protocol }) => protocol);

    expect(new Set(direct)).toEqual(
      new Set([
        "a2s",
        "minecraft-java",
        "minecraft-bedrock",
        "cfx",
        "satisfactory",
        "vintage-story",
        "eco",
      ]),
    );
  });

  it("never plans a destination outside the port range", (): void => {
    for (const port of [1, 65_533, 65_535]) {
      for (const probe of planProbes(port)) {
        expect(probe.port).toBeGreaterThanOrEqual(1);
        expect(probe.port).toBeLessThanOrEqual(65_535);
      }
    }
  });
});

describe("detect", (): void => {
  it("identifies an A2S game from its advertised Steam App ID and queries it as that game", async (): Promise<void> => {
    const { dependencies } = harness({
      a2s: a2sInfoOn(
        28_017,
        sourceInfoPacket({ name: "Rust Server", appId: 252_490 & 0xffff, gameId: 252_490n }),
      ),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 28_015, mode: "summary" },
      dependencies,
    );

    expect(detected).toMatchObject({
      ok: true,
      game: "rust",
      evidence: "advertised",
      result: { ok: true, game: "rust", server: { name: "Rust Server" } },
    });
    expect(detected.probes[0]).toEqual({ protocol: "a2s", port: 28_017, status: "matched" });
  });

  it("matches the truncated 16-bit App ID when no game ID is advertised", async (): Promise<void> => {
    const { dependencies } = harness({
      a2s: a2sInfoOn(27_015, sourceInfoPacket({ appId: 4000 })),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 27_015, mode: "summary" },
      dependencies,
    );

    expect(detected).toMatchObject({ ok: true, game: "garrys-mod", evidence: "advertised" });
  });

  it("falls back to the only game that conventionally uses the answering port", async (): Promise<void> => {
    const { dependencies } = harness({
      a2s: a2sInfoOn(2457, sourceInfoPacket({ appId: 0 })),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 2456, mode: "summary" },
      dependencies,
    );

    expect(detected).toMatchObject({ ok: true, game: "valheim", evidence: "port" });
  });

  it("returns generic A2S from the probe itself when nothing names the game", async (): Promise<void> => {
    const { dependencies, attempts } = harness({
      a2s: a2sInfoOn(27_015, sourceInfoPacket({ appId: 12_345 })),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 27_015, mode: "summary" },
      dependencies,
    );

    expect(detected).toMatchObject({
      ok: true,
      game: "a2s",
      evidence: "fallback",
      result: { ok: true, game: "a2s", data: { appId: 12_345 } },
    });
    // The summary probe already was generic A2S in the requested mode, so it is not repeated.
    expect(attempts.filter((attempt) => attempt === "a2s@27015")).toHaveLength(1);
  });

  it("tells RedM from FiveM by the advertised gamename", async (): Promise<void> => {
    const bodies = {
      "/info.json": await fixture("redm/info.json"),
      "/dynamic.json": await fixture("redm/dynamic.json"),
      "/players.json": await fixture("redm/players.json"),
    };
    const { dependencies } = harness({ cfx: cfxServing(bodies) });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 30_120 },
      dependencies,
    );

    expect(detected).toMatchObject({
      ok: true,
      game: "redm",
      evidence: "advertised",
      result: { ok: true, game: "redm", server: { name: "QueryHost RedM" } },
    });
  });

  it("reuses a game-specific probe answered in the requested mode", async (): Promise<void> => {
    const { dependencies, attempts } = harness({
      vintageStory: await hexFixture("vintage-story/query-complete.hex"),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 42_420, mode: "summary" },
      dependencies,
    );

    expect(detected).toMatchObject({
      ok: true,
      game: "vintage-story",
      evidence: "protocol",
      result: { ok: true, data: { response: "liveness" } },
    });
    expect(attempts.filter((attempt) => attempt === "vintage-story@42420")).toHaveLength(1);
  });

  it("starts no final query once the deadline has passed", async (): Promise<void> => {
    let late = false;
    const answer = a2sInfoOn(28_017, sourceInfoPacket({ gameId: 252_490n }));
    const { dependencies, attempts } = harness({
      a2s: (options) => {
        const reply = answer(options);
        late ||= reply !== undefined;
        return reply;
      },
    });
    const now = dependencies.now;

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 28_015, timeoutMs: 1_000 },
      { ...dependencies, now: () => now() + (late ? 1_000 : 0) },
    );

    expect(detected).toMatchObject({
      ok: true,
      game: "rust",
      result: { ok: false, game: "rust", error: { code: "TIMEOUT" } },
    });
    expect(attempts.filter((attempt) => attempt === "a2s@28017")).toHaveLength(1);
  });

  it("cancels the probes still in flight once one matches", async (): Promise<void> => {
    const { dependencies } = harness({
      silent: true,
      a2s: a2sInfoOn(28_017, sourceInfoPacket({ gameId: 252_490n })),
    });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 28_015, mode: "summary", timeoutMs: 30_000 },
      dependencies,
    );

    expect(detected.ok).toBe(true);
    expect(statuses(detected.probes).slice(0, 4)).toEqual([
      "a2s@28017:matched",
      "a2s@28015:cancelled",
      "minecraft-java@28015:cancelled",
      "minecraft-bedrock@28015:cancelled",
    ]);
    expect(detected.probes.slice(4).every(({ status }) => status === "skipped")).toBe(true);
  });

  it("stops at the probe budget and reports what was tried when nothing answers", async (): Promise<void> => {
    const { dependencies, attempts } = harness();

    const detected = await detectWithDependencies(
      { host: "play.example.com", maxProbes: 3 },
      dependencies,
    );

    expect(detected).toMatchObject({ ok: false, error: { code: "NOT_DETECTED" } });
    expect(detected.probes.filter(({ status }) => status === "failed")).toHaveLength(3);
    expect(detected.probes.slice(3).every(({ status }) => status === "skipped")).toBe(true);
    // Cfx asks its three fixed endpoints of the same destination.
    expect(new Set(attempts).size).toBe(3);
  });

  it("resolves the host once for every probe", async (): Promise<void> => {
    const { dependencies, resolver: dns } = harness();

    await detectWithDependencies({ host: "play.example.com", port: 27_015 }, dependencies);

    expect(dns.resolveAddresses).toHaveBeenCalledTimes(1);
  });

  it("reports a host failure every probe shares", async (): Promise<void> => {
    const { dependencies } = harness({}, []);

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 27_015 },
      dependencies,
    );

    expect(detected).toMatchObject({ ok: false, error: { code: "DNS_FAILED" } });
  });

  it("reports caller cancellation as ABORTED", async (): Promise<void> => {
    const controller = new AbortController();
    controller.abort();
    const { dependencies } = harness({ silent: true });

    const detected = await detectWithDependencies(
      { host: "play.example.com", port: 27_015, signal: controller.signal },
      dependencies,
    );

    expect(detected).toMatchObject({ ok: false, error: { code: "ABORTED" } });
  });

  it.each([
    { maxProbes: 0 },
    { maxProbes: 17 },
    { timeoutMs: 0 },
    { timeoutMs: 30_001 },
    { port: 70_000 },
    { mode: "verbose" },
  ])("rejects invalid input %o without network work", async (fields): Promise<void> => {
    const { dependencies, attempts } = harness();
    // Simulates an untyped JavaScript caller.
    const input = { host: "play.example.com", ...fields } as Parameters<
      typeof detectWithDependencies
    >[0];

    const detected = await detectWithDependencies(input, dependencies);

    expect(detected).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" }, probes: [] });
    expect(attempts).toEqual([]);
  });
});
