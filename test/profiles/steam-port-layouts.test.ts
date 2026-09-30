import { describe, expect, it, vi } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

/**
 * Canonical ID, accepted input, then the query destinations for the default port, a custom game
 * port, and an explicit query port override.
 */
const PORT_LAYOUTS = [
  ["arma-3", "a3", 2400, [2303, 2401, 3000]],
  ["american-truck-simulator", "ats", 28_000, [27_016, 27_016, 3000]],
  ["euro-truck-simulator-2", "ets2", 28_000, [27_016, 27_016, 3000]],
  ["the-forest", "theforest", 28_000, [27_016, 27_016, 3000]],
  ["unturned", "unturned", 28_000, [27_015, 28_000, 3000]],
  ["enshrouded", "enshrouded", 16_000, [15_637, 16_000, 3000]],
  ["insurgency-sandstorm", "sandstorm", 28_000, [27_131, 27_131, 3000]],
] as const;

describe.each(PORT_LAYOUTS)("%s game profile", (game, alias, customPort, expected): void => {
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
});

describe.each(PORT_LAYOUTS.filter(([game]) => game !== "arma-3"))("%s full query", (game): void => {
  it("merges Player and raw Rules", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game, host: "play.example.com" },
      dependencies(await fixtureA2s("steam-query-port")),
    );

    expect(result).toMatchObject({
      ok: true,
      game,
      data: { players: [{ name: "Survivor" }, { name: "" }] },
      rawData: { rules: { SESSIONFLAGS: "683", ServerPassword_b: "false" } },
      partial: false,
    });
  });
});

describe("arma-3 full query", (): void => {
  it("reports binary Rules as unsupported without querying them", async (): Promise<void> => {
    const base = await fixtureA2s("steam-query-port");
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));
    const result = await queryWithDependencies(
      { game: "arma-3", host: "play.example.com" },
      dependencies({ collect }),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "arma-3",
      data: { players: [{ name: "Survivor" }, { name: "" }] },
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "ok" },
        { source: "a2s-rules", status: "unsupported" },
      ],
      partial: false,
      warnings: [],
    });
    expect(collect.mock.calls.map(([options]) => packetType(options))).toEqual([0x54, 0x55]);
    if (!result.ok) {
      throw new Error("Expected a successful Arma 3 result.");
    }
    expect(result.rawData).toBeUndefined();
  });
});
