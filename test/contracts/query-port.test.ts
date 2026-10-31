import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { GAME_IDS, GAME_REGISTRY, resolveQueryPort, type GameInputId } from "../../src/index.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

describe("resolveQueryPort", (): void => {
  it("derives each registry convention", (): void => {
    expect(resolveQueryPort("rust")).toBe(28_017);
    expect(resolveQueryPort("rust", { port: 28_100 })).toBe(28_102);
    expect(resolveQueryPort("palworld", { port: 8300 })).toBe(27_015);
    expect(resolveQueryPort("dst", { port: 11_000 })).toBe(27_016);
    expect(resolveQueryPort("counter-strike-2", { port: 27_020 })).toBe(27_020);
    expect(resolveQueryPort("minecraft-java")).toBe(25_565);
    expect(resolveQueryPort("vintage-story")).toBe(42_420);
  });

  it("lets an explicit query port win", (): void => {
    expect(resolveQueryPort("rust", { port: 28_100, queryPort: 3000 })).toBe(3000);
    expect(resolveQueryPort("rust", { queryPort: 3000 })).toBe(3000);
  });

  it("uses the given port for generic A2S and has no default without one", (): void => {
    expect(resolveQueryPort("a2s", { port: 27_015 })).toBe(27_015);
    expect(resolveQueryPort("a2s")).toBeUndefined();
    // query() takes generic A2S's destination only as `port`.
    expect(resolveQueryPort("a2s", { queryPort: 27_015 })).toBeUndefined();
  });

  it.each([0, 65_536, 1.5, Number.NaN, -1])("rejects the invalid port %d", (port): void => {
    expect(resolveQueryPort("rust", { port })).toBeUndefined();
    expect(resolveQueryPort("rust", { queryPort: port })).toBeUndefined();
    // An invalid game port is rejected even when an explicit query port is valid, as query() does.
    expect(resolveQueryPort("rust", { port, queryPort: 28_017 })).toBeUndefined();
  });

  it("rejects an offset that moves a custom game port out of range", (): void => {
    // Rust's query port is the game port + 2.
    expect(resolveQueryPort("rust", { port: 65_534 })).toBeUndefined();
    expect(resolveQueryPort("rust", { port: 65_533 })).toBe(65_535);
  });

  it("returns undefined for an unregistered game from untyped JavaScript", (): void => {
    expect(resolveQueryPort("not-a-game" as GameInputId)).toBeUndefined();
  });

  it("accepts aliases", (): void => {
    expect(resolveQueryPort("dst")).toBe(resolveQueryPort("dont-starve-together"));
  });

  it.each(
    GAME_IDS.filter((game) => {
      const { protocol } = GAME_REGISTRY[game];
      return protocol === "a2s" || protocol === "a2s-unreal";
    }),
  )("matches the destination query() uses for %s", async (game): Promise<void> => {
    const base = await fixtureA2s("steam-query-port");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };

    await queryWithDependencies(
      { game, host: "play.example.com", port: 20_000, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([resolveQueryPort(game, { port: 20_000 })]);
  });
});
