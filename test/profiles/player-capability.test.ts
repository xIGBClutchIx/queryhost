import { describe, expect, it } from "vitest";

import type { GameDataMap, GameId } from "../../src/contracts/query.js";
import { GAME_IDS, GAME_REGISTRY } from "../../src/contracts/registry.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

/**
 * The `players` capability means "a player list can be returned". A game whose data contract has
 * no `players` field can never return one, so its registry level must be `unsupported`.
 */
type HasPlayerList<G extends GameId> = "players" extends keyof GameDataMap[G] ? true : false;
type GamesWithoutPlayerList = {
  [G in GameId]: HasPlayerList<G> extends true ? never : G;
}[GameId];

// `Record` makes this list exhaustive: adding a players field to one of these contracts, or a game
// without one, fails compilation until the list and the registry level are reviewed.
const WITHOUT_PLAYER_LIST: Readonly<Record<GamesWithoutPlayerList, true>> = {
  dayz: true,
  "minecraft-bedrock": true,
  satisfactory: true,
  "vintage-story": true,
};

const A2S_GAMES = GAME_IDS.filter((game) => {
  const { protocol } = GAME_REGISTRY[game];
  return protocol === "a2s" || protocol === "a2s-unreal";
});

describe("players capability", (): void => {
  it.each(Object.keys(WITHOUT_PLAYER_LIST))(
    "declares %s unsupported because its contract has no player list",
    (game) => {
      expect(Object.hasOwn(GAME_REGISTRY, game)).toBe(true);
      expect(GAME_REGISTRY[game as GameId].capabilities.players).toBe("unsupported");
    },
  );

  it("declares no game supported, because every player list depends on server configuration", () => {
    // Each list comes from an optional source (A2S Player, Minecraft Query, Cfx players.json) or a
    // field servers may leave out (Eco, Project Reclaimer), so none is guaranteed.
    const supported = GAME_IDS.filter(
      (game) => GAME_REGISTRY[game].capabilities.players === "supported",
    );
    expect(supported).toEqual([]);
  });

  it.each(A2S_GAMES)(
    "returns %s's player list exactly when the registry allows it",
    async (game): Promise<void> => {
      const result = await queryWithDependencies(
        // Generic A2S has no default port, so every game gets an explicit query destination.
        { game, host: "play.example.com", port: 27_015, queryPort: 27_015 },
        dependencies(await fixtureA2s("steam-query-port")),
      );
      if (!result.ok) {
        throw new Error(`Expected ${game} to answer the A2S fixture.`);
      }
      const player = result.sources.find(({ source }) => source === "a2s-player");
      const players = "players" in result.data ? result.data.players : undefined;
      if (GAME_REGISTRY[game].capabilities.players === "unsupported") {
        expect(player?.status).toBe("unsupported");
        expect(players).toBeUndefined();
      } else {
        expect(player?.status).toBe("ok");
        expect(Array.isArray(players)).toBe(true);
      }
    },
  );
});
