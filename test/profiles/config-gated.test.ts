import { describe, expect, it, vi } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

/**
 * Games registered only through `GAME_REGISTRY`, whose servers answer A2S once a server setting
 * enables it. Canonical ID, accepted input, custom game port, the query destinations for the
 * default port, that custom port, and an explicit query port, and whether Unreal session values
 * are decoded.
 */
const CONFIG_GATED = [
  ["arma-reforger", "reforger", 2100, [17_777, 17_777, 3000], false],
  ["starbound", "starbound", 21_100, [21_025, 21_025, 3000], false],
  ["space-engineers", "spaceengineers", 28_000, [27_016, 28_000, 3000], false],
  ["humanitz", "humanitz", 7800, [27_015, 27_015, 3000], true],
  ["v-rising", "vrising", 10_000, [9877, 9877, 3000], false],
] as const;

describe.each(CONFIG_GATED)(
  "%s game profile",
  (game, alias, customPort, expected, unreal): void => {
    it("resolves its alias and follows the game's query-port rule", async (): Promise<void> => {
      const base = await fixtureA2s("steam-query-port");
      const ports: number[] = [];
      const a2s: A2sExchangeDependencies = {
        collect(options): Promise<UdpCollectionResult> {
          ports.push(options.target.port);
          return base.collect(options);
        },
      };
      const first = await queryWithDependencies(
        { game: alias, host: "play.example.com", mode: "summary" },
        dependencies(a2s),
      );
      await queryWithDependencies(
        { game, host: "play.example.com", port: customPort, mode: "summary" },
        dependencies(a2s),
      );
      await queryWithDependencies(
        { game, host: "play.example.com", queryPort: 3000, mode: "summary" },
        dependencies(a2s),
      );

      expect(first).toMatchObject({
        ok: true,
        game,
        server: { name: "QueryHost Steam Fixture", players: { online: 2, max: 70 } },
        data: { tags: ["pve", "crossplay"] },
      });
      expect(ports).toEqual(expected);
    });

    it("decodes Unreal session values only for Unreal Engine games", async (): Promise<void> => {
      const result = await queryWithDependencies(
        { game, host: "play.example.com" },
        dependencies(await fixtureA2s("steam-query-port")),
      );

      expect(result).toMatchObject({
        ok: true,
        game,
        rawData: { rules: { SESSIONFLAGS: "683", ServerPassword_b: "false" } },
        partial: false,
      });
      expect(result.ok && "sessionFlags" in result.data).toBe(unreal);
    });
  },
);

describe.each(CONFIG_GATED.filter(([game]) => game !== "arma-reforger"))(
  "%s full query",
  (game): void => {
    it("merges Player records", async (): Promise<void> => {
      const result = await queryWithDependencies(
        { game, host: "play.example.com" },
        dependencies(await fixtureA2s("steam-query-port")),
      );

      expect(result).toMatchObject({
        ok: true,
        data: { players: [{ name: "Survivor" }, { name: "" }] },
      });
    });
  },
);

describe("arma-reforger full query", (): void => {
  it("reports Player as unsupported without querying it", async (): Promise<void> => {
    const base = await fixtureA2s("steam-query-port");
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));
    const result = await queryWithDependencies(
      { game: "arma-reforger", host: "play.example.com" },
      dependencies({ collect }),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "arma-reforger",
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "unsupported" },
        { source: "a2s-rules", status: "ok" },
      ],
      partial: false,
      warnings: [],
    });
    expect(result.ok && "players" in result.data).toBe(false);
    expect(collect.mock.calls.map(([options]) => packetType(options))).toEqual([0x54, 0x56]);
  });
});
