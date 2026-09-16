import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { DnsAddressRecord, DnsResolver } from "../../src/network/target.js";
import type { SatisfactoryQueryDependencies } from "../../src/protocols/satisfactory/query.js";
import { querySatisfactoryProfile } from "../../src/profiles/satisfactory.js";
import { queryWithDependencies, type QueryDependencies } from "../../src/runtime/client.js";
import { createExecutionContext } from "../../src/runtime/execution.js";
import { HttpTransportError } from "../../src/transports/http.js";
import { UdpTransportError } from "../../src/transports/udp.js";

const ADDRESS: DnsAddressRecord = Object.freeze({ address: "93.184.216.34", family: 4 });
const LIGHTWEIGHT = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL("../fixtures/satisfactory/lightweight.hex", import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  ),
);
const HEALTH = new TextEncoder().encode(
  readFileSync(new URL("../fixtures/satisfactory/health.json", import.meta.url), "utf8"),
);

function resolver(addresses: readonly DnsAddressRecord[] = [ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn(() => Promise.resolve(addresses)),
    resolveSrv: vi.fn(() => Promise.resolve([])),
  };
}

function dependencies(
  satisfactory: SatisfactoryQueryDependencies,
  addresses: readonly DnsAddressRecord[] = [ADDRESS],
): QueryDependencies {
  const words = [0x0102_0304, 0x0506_0708];
  let word = 0;
  let clock = 0;
  return {
    satisfactory,
    resolver: resolver(addresses),
    random(): number {
      const value = words[word];
      word += 1;
      return (value ?? 0) / 0x1_0000_0000;
    },
    now(): number {
      clock += 25;
      return clock;
    },
  };
}

function successful(): SatisfactoryQueryDependencies {
  return {
    udpExchange(options) {
      expect(options.target.port).toBe(7777);
      expect(Buffer.from(options.request).toString("hex")).toBe("d5f60001080706050403020101");
      return Promise.resolve({
        data: LIGHTWEIGHT,
        rttMs: 7,
        address: options.address,
        port: options.target.port,
      });
    },
    httpExchange(options) {
      expect(options).toMatchObject({
        protocol: "https",
        path: "/api/v1",
        method: "POST",
        contentType: "application/json",
        tlsCertificatePolicy: "disabled",
      });
      expect(new TextDecoder().decode(options.body)).toBe(
        '{"function":"HealthCheck","data":{"clientCustomData":""}}',
      );
      return Promise.resolve({
        statusCode: 200,
        data: HEALTH,
        rttMs: 13,
        address: options.address,
        port: options.target.port,
      });
    },
  };
}

describe("Satisfactory game profile", (): void => {
  it.each(["ABORTED", "TIMEOUT"] as const)(
    "preserves HTTPS transport attribution when health is interrupted by %s",
    async (code): Promise<void> => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const scope = createExecutionContext({ timeoutMs: 50, signal: controller.signal });
      const completed = vi.fn();
      const words = [0x0102_0304, 0x0506_0708];
      let nextWord = 0;
      try {
        const result = querySatisfactoryProfile({
          scope,
          target: { hostname: "play.example.com", port: 7777, addresses: [ADDRESS] },
          mode: "full",
          random: () => (words[nextWord++] ?? 0) / 0x1_0000_0000,
          observer: { onSourceStarted: vi.fn(), onSourceCompleted: completed },
          query: {
            udpExchange(options) {
              return Promise.resolve({
                data: LIGHTWEIGHT,
                rttMs: 7,
                address: options.address,
                port: options.target.port,
              });
            },
            httpExchange() {
              if (code === "ABORTED") controller.abort();
              else vi.advanceTimersByTime(50);
              return Promise.reject(new HttpTransportError(code));
            },
          },
        });
        await expect(result).rejects.toMatchObject({
          name: "HttpTransportError",
          code,
          message: new HttpTransportError(code).message,
        });
        expect(completed.mock.calls).toEqual([
          [{ source: "satisfactory-lightweight", status: "ok", rttMs: 7 }],
        ]);
      } finally {
        scope.close();
        vi.useRealTimers();
      }
    },
  );

  it("merges the required lightweight state with optional credential-free health", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "satisfactory", host: "play.example.com" },
      dependencies(successful()),
    );
    expect(result).toEqual({
      ok: true,
      game: "satisfactory",
      server: { name: "Factory α", version: "12345678", queryRttMs: 7 },
      data: { state: "playing", serverNetCl: 12_345_678, modded: true, health: "healthy" },
      rawData: {
        stateCode: 3,
        serverFlags: "1",
        subStates: [
          { id: 0, version: 0x1234 },
          { id: 1, version: 2 },
          { id: 3, version: 65_535 },
        ],
        health: { health: "healthy", serverCustomData: "" },
      },
      sources: [
        { source: "satisfactory-lightweight", status: "ok", rttMs: 7 },
        { source: "satisfactory-health", status: "ok", rttMs: 13 },
      ],
      warnings: [],
      partial: false,
      durationMs: 25,
    });
  });

  it("skips HTTPS in summary mode without inventing health", async (): Promise<void> => {
    const query = successful();
    const httpExchange = vi.fn(query.httpExchange);
    const result = await queryWithDependencies(
      { game: "satisfactory", host: "play.example.com", mode: "summary" },
      dependencies({ ...query, httpExchange }),
    );
    expect(httpExchange).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      data: { state: "playing" },
      sources: [
        { source: "satisfactory-lightweight", status: "ok" },
        { source: "satisfactory-health", status: "not-requested" },
      ],
      warnings: [],
      partial: false,
    });
    if (result.ok && result.game === "satisfactory") {
      expect(result.data.health).toBeUndefined();
      expect(result.rawData?.health).toBeUndefined();
    }
  });

  it("skips HTTPS while lightweight status reports loading", async (): Promise<void> => {
    const loading = Uint8Array.from(LIGHTWEIGHT);
    loading[12] = 2;
    const query = successful();
    const httpExchange = vi.fn(query.httpExchange);
    const result = await queryWithDependencies(
      { game: "satisfactory", host: "play.example.com" },
      dependencies({
        ...query,
        udpExchange(options) {
          return Promise.resolve({
            data: loading,
            rttMs: 7,
            address: options.address,
            port: options.target.port,
          });
        },
        httpExchange,
      }),
    );
    expect(httpExchange).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      data: { state: "loading" },
      sources: [
        { source: "satisfactory-lightweight", status: "ok" },
        { source: "satisfactory-health", status: "not-requested" },
      ],
      partial: false,
    });
  });

  it("retains required status when optional HTTPS times out", async (): Promise<void> => {
    const query = successful();
    const result = await queryWithDependencies(
      { game: "satisfactory", host: "play.example.com" },
      dependencies({
        ...query,
        httpExchange: () => Promise.reject(new HttpTransportError("TIMEOUT")),
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      sources: [
        { source: "satisfactory-lightweight", status: "ok" },
        { source: "satisfactory-health", status: "timeout" },
      ],
      warnings: [
        { code: "PARTIAL_RESULT" },
        { code: "SOURCE_TIMEOUT", source: "satisfactory-health" },
      ],
      partial: true,
    });
  });

  it("maps a required lightweight timeout to stable provenance", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "satisfactory", host: "play.example.com" },
      dependencies({ udpExchange: () => Promise.reject(new UdpTransportError("TIMEOUT")) }),
    );
    expect(result).toEqual({
      ok: false,
      game: "satisfactory",
      error: {
        code: "TIMEOUT",
        message: "The UDP exchange timed out.",
        source: "satisfactory-lightweight",
      },
      durationMs: 25,
      sources: [{ source: "satisfactory-lightweight", status: "timeout" }],
      warnings: [],
    });
  });
});
