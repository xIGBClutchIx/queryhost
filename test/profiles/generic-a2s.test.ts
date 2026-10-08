import { describe, expect, it, vi } from "vitest";

import type { DnsResolver } from "../../src/network/target.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

describe("generic A2S profile", (): void => {
  it("returns common protocol facts, optional players, and raw rules", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "a2s", host: "play.example.com", port: 27_015 },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "a2s",
      server: {
        name: "QueryHost Rust Fixture",
        map: "Procedural Map",
        version: "2600",
        players: { online: 12, max: 100 },
      },
      data: {
        protocol: 17,
        game: "Rust",
        folder: "rust",
        bots: 0,
        serverType: "dedicated",
        environment: "linux",
        vac: true,
        appId: 55_882,
        tags: ["mp100", "cp0", "weekly", "vanilla"],
        players: [
          { index: 0, name: "Alice", score: 10, durationSeconds: 123.5 },
          { index: 1, name: "Bob", score: -2, durationSeconds: 2.25 },
        ],
      },
      rawData: { rules: { "world.seed": "123456" } },
      partial: false,
    });
  });

  it("requires the caller to supply the A2S query port", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "a2s", host: "play.example.com" },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "a2s",
      error: { code: "INVALID_INPUT" },
      sources: [],
    });
  });

  it("answers from a later address without waiting out a silent first one", async (): Promise<void> => {
    const live = await fixtureA2s("rust");
    const dns: DnsResolver = {
      resolveAddresses: vi.fn(() =>
        Promise.resolve([
          { address: "93.184.216.34", family: 4 as const },
          { address: "93.184.216.35", family: 4 as const },
        ]),
      ),
      resolveSrv: vi.fn(() => Promise.resolve([])),
    };
    const contacted: string[] = [];
    const startedMs = performance.now();

    const result = await queryWithDependencies(
      { game: "a2s", host: "play.example.com", port: 27_015 },
      dependencies(
        {
          collect(options): Promise<UdpCollectionResult> {
            contacted.push(options.address.address);
            if (options.address.address === "93.184.216.34") {
              return new Promise((_resolve, reject) => {
                options.scope.signal.addEventListener("abort", () => {
                  reject(new Error("silent address cancelled"));
                });
              });
            }
            return live.collect(options);
          },
        },
        dns,
      ),
    );

    expect(result).toMatchObject({ ok: true, server: { name: "QueryHost Rust Fixture" } });
    expect(performance.now() - startedMs).toBeLessThan(1_000);
    // Player and Rules follow the address that answered Info.
    expect(contacted).toEqual(["93.184.216.34", "93.184.216.35", "93.184.216.35", "93.184.216.35"]);
  });
});
