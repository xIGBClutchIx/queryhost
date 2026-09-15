import { describe, expect, it, vi } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

describe("Don't Starve Together profile", (): void => {
  it("returns typed shard facts, players, and untouched rules", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "dont-starve-together", host: "play.example.com" },
      dependencies(await fixtureA2s("dont-starve-together")),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "dont-starve-together",
      server: {
        name: "QueryHost DST Fixture",
        map: "Master",
        version: "747465",
        password: false,
        players: { online: 2, max: 6 },
      },
      data: {
        protocol: 17,
        game: "Don't Starve Together",
        folder: "dontstarvetogether",
        bots: 0,
        serverType: "dedicated",
        environment: "linux",
        vac: true,
        appId: 60_186,
        steamGameId: "322330",
        tags: ["survival", "cooperative", "mods"],
        players: [
          { index: 0, name: "Wilson", score: 3, durationSeconds: 45.5 },
          { index: 1, name: "Willow", score: -1, durationSeconds: 7.25 },
        ],
      },
      rawData: {
        rules: {
          hostname: "QueryHost DST Fixture",
          cluster_intention: "cooperative",
          game_mode: "survival",
          mods: "true",
        },
      },
      partial: false,
    });
  });

  it("uses the independent Steam query port for custom gameplay ports", async (): Promise<void> => {
    const fixture = await fixtureA2s("dont-starve-together");
    const collect = vi.fn((options: UdpCollectionOptions): Promise<UdpCollectionResult> =>
      fixture.collect(options),
    );
    const a2s: A2sExchangeDependencies = { collect };

    const result = await queryWithDependencies(
      { game: "dst", host: "play.example.com", port: 11_000, mode: "summary" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({ ok: true, game: "dont-starve-together" });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect.mock.calls[0]?.[0].target.port).toBe(27_016);
  });

  it("omits unrequested optional values instead of fabricating empty data", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "dont-starve-together", host: "play.example.com", mode: "summary" },
      dependencies(await fixtureA2s("dont-starve-together")),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { protocol: 17 },
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "not-requested" },
        { source: "a2s-rules", status: "not-requested" },
      ],
      partial: false,
    });
    if (!result.ok || result.game !== "dont-starve-together") {
      throw new Error("The DST fixture query unexpectedly failed.");
    }
    expect(result.data.players).toBeUndefined();
    expect(result.rawData).toBeUndefined();
  });

  it("honors an explicitly configured per-shard Steam query port", async (): Promise<void> => {
    const fixture = await fixtureA2s("dont-starve-together");
    const collect = vi.fn((options: UdpCollectionOptions): Promise<UdpCollectionResult> =>
      fixture.collect(options),
    );
    const a2s: A2sExchangeDependencies = { collect };

    const result = await queryWithDependencies(
      {
        game: "dontstarvetogether",
        host: "play.example.com",
        port: 11_000,
        queryPort: 27_018,
        mode: "summary",
      },
      dependencies(a2s),
    );

    expect(result).toMatchObject({ ok: true, game: "dont-starve-together" });
    expect(collect.mock.calls[0]?.[0].target.port).toBe(27_018);
  });
});
