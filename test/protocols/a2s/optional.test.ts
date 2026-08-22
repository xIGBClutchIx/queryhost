import type { RemoteInfo, Socket } from "node:dgram";

import { afterEach, describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../../src/network/target.js";
import type { A2sExchangeDependencies } from "../../../src/protocols/a2s/network.js";
import { queryA2sOptionalSources } from "../../../src/protocols/a2s/optional.js";
import { createExecutionContext } from "../../../src/runtime/execution.js";
import {
  UdpTransportError,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../../../src/transports/udp.js";
import { startFakeUdpServer, stopAllFakeUdpServers } from "../../helpers/fake-udp-server.js";

const ADDRESS: PinnedAddress = Object.freeze({ address: "127.0.0.1", family: 4 });
const TARGET: PinnedTarget = Object.freeze({
  hostname: ADDRESS.address,
  port: 27_015,
  addresses: Object.freeze([ADDRESS]),
});
const PLAYER_RESPONSE = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x44, 0);
const RULES_RESPONSE = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x45, 0, 0);
const MALFORMED_RESPONSE = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0);

function challengePacket(value: number): Uint8Array {
  const packet = new Uint8Array(9);
  packet.set(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x41));
  new DataView(packet.buffer).setInt32(5, value, true);
  return packet;
}

function send(server: Socket, packet: Uint8Array, remote: RemoteInfo): void {
  server.send(packet, remote.port, remote.address);
}

function sourceType(options: UdpCollectionOptions): number {
  const type = options.request[4];
  if (type === undefined) {
    throw new Error("The test request has no A2S source byte.");
  }
  return type;
}

function result(options: UdpCollectionOptions, packet: Uint8Array, rttMs = 1): UdpCollectionResult {
  return {
    datagrams: Object.freeze([packet]),
    rttMs,
    address: options.address,
    port: options.target.port,
  };
}

function options(scope: ReturnType<typeof createExecutionContext>) {
  return {
    scope,
    target: TARGET,
    address: ADDRESS,
    operationTimeoutMs: 100,
    player: "query" as const,
    rules: "query" as const,
  };
}

afterEach(async (): Promise<void> => {
  await stopAllFakeUdpServers();
});

describe("optional A2S source collection", (): void => {
  it("starts Player and Rules concurrently and preserves deterministic report order", async (): Promise<void> => {
    let calls = 0;
    let release: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const dependencies: A2sExchangeDependencies = {
      async collect(request): Promise<UdpCollectionResult> {
        calls += 1;
        if (calls === 2) {
          release?.();
        }
        await bothStarted;
        const type = sourceType(request);
        return result(
          request,
          type === 0x55 ? PLAYER_RESPONSE : RULES_RESPONSE,
          type === 0x55 ? 7 : 3,
        );
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const value = await queryA2sOptionalSources(options(scope), dependencies);
    scope.close();

    expect(calls).toBe(2);
    expect(value.players).toEqual([]);
    expect(value.rules).toEqual({});
    expect(value.sources).toEqual([
      { source: "a2s-player", status: "ok", rttMs: 7 },
      { source: "a2s-rules", status: "ok", rttMs: 3 },
    ]);
  });

  it("runs both challenge flows concurrently through a fake UDP server", async (): Promise<void> => {
    const waiting = new Map<number, RemoteInfo>();
    let requests = 0;
    const server = await startFakeUdpServer((socket, request, remote): void => {
      requests += 1;
      const type = request[4];
      if (type !== 0x55 && type !== 0x56) {
        throw new Error("Unexpected A2S request type.");
      }
      const providedChallenge = request.readInt32LE(5);
      const expectedChallenge = type === 0x55 ? 101 : 202;
      if (providedChallenge === -1) {
        waiting.set(type, remote);
        if (waiting.size === 2) {
          const playerRemote = waiting.get(0x55);
          const rulesRemote = waiting.get(0x56);
          if (playerRemote === undefined || rulesRemote === undefined) {
            throw new Error("Both optional source requests must be waiting.");
          }
          send(socket, challengePacket(101), playerRemote);
          send(socket, challengePacket(202), rulesRemote);
        }
        return;
      }
      if (providedChallenge !== expectedChallenge) {
        throw new Error("The A2S challenge retry did not echo the server token.");
      }
      send(socket, type === 0x55 ? PLAYER_RESPONSE : RULES_RESPONSE, remote);
    });
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const value = await queryA2sOptionalSources({
      ...options(scope),
      target: Object.freeze({
        hostname: ADDRESS.address,
        port: server.port,
        addresses: Object.freeze([ADDRESS]),
      }),
    });
    scope.close();

    expect(requests).toBe(4);
    expect(value.players).toEqual([]);
    expect(value.rules).toEqual({});
    expect(value.sources.map((source) => source.status)).toEqual(["ok", "ok"]);
  });

  it("reports timeout and malformed independently without rejecting the enrichment", async (): Promise<void> => {
    const dependencies: A2sExchangeDependencies = {
      collect(request): Promise<UdpCollectionResult> {
        if (sourceType(request) === 0x55) {
          return Promise.reject(new UdpTransportError("TIMEOUT"));
        }
        return Promise.resolve(result(request, MALFORMED_RESPONSE));
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const value = await queryA2sOptionalSources(options(scope), dependencies);
    scope.close();

    expect(value.players).toBeUndefined();
    expect(value.rules).toBeUndefined();
    expect(value.sources).toEqual([
      { source: "a2s-player", status: "timeout" },
      { source: "a2s-rules", status: "malformed" },
    ]);
  });

  it("represents blocked, unsupported, and not-requested sources without network work", async (): Promise<void> => {
    let calls = 0;
    const dependencies: A2sExchangeDependencies = {
      collect(): Promise<UdpCollectionResult> {
        calls += 1;
        return Promise.reject(new Error("A policy-skipped source must not perform network work."));
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    const base = options(scope);

    const blocked = await queryA2sOptionalSources(
      { ...base, player: "blocked", rules: "unsupported" },
      dependencies,
    );
    const omitted = await queryA2sOptionalSources(
      { ...base, player: "not-requested", rules: "not-requested" },
      dependencies,
    );
    scope.close();

    expect(calls).toBe(0);
    expect(blocked.sources).toEqual([
      { source: "a2s-player", status: "blocked" },
      { source: "a2s-rules", status: "unsupported" },
    ]);
    expect(omitted.sources).toEqual([
      { source: "a2s-player", status: "not-requested" },
      { source: "a2s-rules", status: "not-requested" },
    ]);
  });

  it("uses failed for a non-timeout transport failure", async (): Promise<void> => {
    const dependencies: A2sExchangeDependencies = {
      collect(): Promise<UdpCollectionResult> {
        return Promise.reject(new UdpTransportError("CONNECTION_FAILED"));
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000 });

    const value = await queryA2sOptionalSources(options(scope), dependencies);
    scope.close();

    expect(value.sources.map((source) => source.status)).toEqual(["failed", "failed"]);
  });

  it("does not turn whole-query cancellation into optional provenance", async (): Promise<void> => {
    const controller = new AbortController();
    const dependencies: A2sExchangeDependencies = {
      collect(request): Promise<UdpCollectionResult> {
        return new Promise((_resolve, reject): void => {
          if (request.scope.signal.aborted) {
            reject(new UdpTransportError("ABORTED"));
            return;
          }
          request.scope.signal.addEventListener(
            "abort",
            (): void => {
              reject(new UdpTransportError("ABORTED"));
            },
            { once: true },
          );
        });
      },
    };
    const scope = createExecutionContext({ timeoutMs: 1_000, signal: controller.signal });
    const pending = queryA2sOptionalSources(options(scope), dependencies);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    scope.close();
  });

  it("validates the per-source timeout before starting work", async (): Promise<void> => {
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    await expect(
      queryA2sOptionalSources({ ...options(scope), operationTimeoutMs: 0 }),
    ).rejects.toThrow(RangeError);
    scope.close();
  });
});
