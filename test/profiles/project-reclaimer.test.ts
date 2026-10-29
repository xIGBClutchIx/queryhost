import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { ProjectReclaimerQueryDependencies } from "../../src/protocols/project-reclaimer/status.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import {
  QuicTransportError,
  type QuicExchangeOptions,
  type QuicExchangeResult,
} from "../../src/transports/quic.js";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const SECOND_ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.35", family: 4 });

function fixture(name: string): Uint8Array {
  return readFileSync(new URL(`../fixtures/project-reclaimer/${name}.json`, import.meta.url));
}

function framed(body: Uint8Array | string): Uint8Array {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const result = new Uint8Array(4 + bytes.byteLength);
  new DataView(result.buffer).setUint32(0, bytes.byteLength);
  result.set(bytes, 4);
  return result;
}

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn((): Promise<readonly DnsAddressRecord[]> => Promise.resolve(addresses)),
    resolveSrv: vi.fn((): Promise<readonly []> => Promise.resolve([])),
  };
}

function dependencies(
  projectReclaimer: ProjectReclaimerQueryDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let nowCalls = 0;
  return {
    resolver: dns,
    projectReclaimer,
    now(): number {
      nowCalls += 1;
      return nowCalls === 1 ? 100 : 130;
    },
  };
}

function response(options: QuicExchangeOptions, body: Uint8Array): QuicExchangeResult {
  return Object.freeze({
    data: framed(body),
    rttMs: 48,
    address: options.address,
    port: options.target.port,
  });
}

describe("Project Reclaimer game profile", (): void => {
  it("queries the UDP game port over QUIC and normalizes the status", async (): Promise<void> => {
    const requests: QuicExchangeOptions[] = [];
    const exchange: ProjectReclaimerQueryDependencies["exchange"] = (options) => {
      requests.push(options);
      return Promise.resolve(response(options, fixture("status-players")));
    };
    const result = await queryWithDependencies(
      { game: "project-reclaimer", host: "play.example.com" },
      dependencies({ exchange }),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      target: { hostname: "play.example.com", port: 49_176 },
      address: PUBLIC_ADDRESS,
      serverName: "reclaimer",
      tlsCertificatePolicy: "disabled",
      maxResponseBytes: 65_536,
    });
    expect(Buffer.from(requests[0]?.request ?? []).toString()).toBe(
      '\u0000\u0000\u0000\f{"status":2}',
    );
    expect(result).toEqual({
      ok: true,
      game: "project-reclaimer",
      server: {
        name: "Synthetic Territories",
        map: "Reactor · Custom",
        version: "0.9.23",
        password: true,
        players: { online: 3, max: 72 },
        queryRttMs: 48,
      },
      data: {
        hostName: "Example Hosting",
        mode: "Territories",
        variant: "Vehicle Shop Territories",
        ready: false,
        blocksVpn: true,
        maxPingMs: 400,
        players: ["Player One", "Player Two", "Player Three"],
        mods: [
          {
            id: "704a09b96a43a7ce7ae21d6a538289d7b7afbd765aaac2bfe2c7677d38d77fe0",
            title: "Map Pack",
            maps: [
              {
                stem: "s3d_reactor",
                digest: "1f95e0329202f4e8765f49c0089fed95d3e9083dd8d90cb5361e769748d96c11",
              },
            ],
            sizeBytes: 7_073_505_624,
            shared: true,
          },
        ],
      },
      sources: [{ source: "project-reclaimer-status", status: "ok", rttMs: 48 }],
      partial: false,
      warnings: [],
      durationMs: 30,
    });
  });

  it("accepts the reclaimer alias and a custom game port", async (): Promise<void> => {
    const ports: number[] = [];
    const exchange: ProjectReclaimerQueryDependencies["exchange"] = (options) => {
      ports.push(options.target.port);
      return Promise.resolve(response(options, fixture("status-odst")));
    };
    const result = await queryWithDependencies(
      { game: "reclaimer", host: "play.example.com", port: 49_180 },
      dependencies({ exchange }),
    );

    expect(ports).toEqual([49_180]);
    expect(result).toMatchObject({
      ok: true,
      game: "project-reclaimer",
      data: { mode: "Firefight (Legendary)", odst: { mission: 6110 } },
    });
  });

  it("omits facts the server did not send", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "project-reclaimer", host: "play.example.com" },
      dependencies({
        exchange: (options) => Promise.resolve(response(options, new TextEncoder().encode("{}"))),
      }),
    );

    expect(result).toMatchObject({ ok: true, server: { queryRttMs: 48 }, data: {} });
    expect(result.ok && result.server.players).toBeUndefined();
  });

  it("falls back to the next validated address", async (): Promise<void> => {
    const tried: string[] = [];
    const exchange: ProjectReclaimerQueryDependencies["exchange"] = (options) => {
      tried.push(options.address.address);
      return options.address.address === PUBLIC_ADDRESS.address
        ? Promise.reject(new QuicTransportError("CONNECTION_FAILED"))
        : Promise.resolve(response(options, fixture("status-plain")));
    };
    const result = await queryWithDependencies(
      { game: "project-reclaimer", host: "play.example.com" },
      dependencies({ exchange }, resolver([PUBLIC_ADDRESS, SECOND_ADDRESS])),
    );

    expect(result.ok).toBe(true);
    expect(tried).toEqual([PUBLIC_ADDRESS.address, SECOND_ADDRESS.address]);
  });

  it.each([
    [
      "a handshake timeout",
      (): Promise<QuicExchangeResult> => Promise.reject(new QuicTransportError("TIMEOUT")),
      "TIMEOUT",
      "timeout",
    ],
    [
      "a refused connection",
      (): Promise<QuicExchangeResult> =>
        Promise.reject(new QuicTransportError("CONNECTION_FAILED")),
      "CONNECTION_FAILED",
      "failed",
    ],
    [
      "an oversized answer",
      (): Promise<QuicExchangeResult> =>
        Promise.reject(new QuicTransportError("RESPONSE_TOO_LARGE")),
      "RESPONSE_TOO_LARGE",
      "malformed",
    ],
    [
      "malformed JSON",
      (options: QuicExchangeOptions): Promise<QuicExchangeResult> =>
        Promise.resolve(response(options, new TextEncoder().encode("{"))),
      "MALFORMED_RESPONSE",
      "malformed",
    ],
  ] as const)(
    "fails with a stable error for %s",
    async (_label, exchange, code, status): Promise<void> => {
      const result = await queryWithDependencies(
        { game: "project-reclaimer", host: "play.example.com" },
        dependencies({ exchange }),
      );
      expect(result).toMatchObject({
        ok: false,
        game: "project-reclaimer",
        error: { code, source: "project-reclaimer-status" },
        sources: [{ source: "project-reclaimer-status", status }],
      });
    },
  );
});
