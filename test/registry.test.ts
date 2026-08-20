import { describe, expect, it } from "vitest";

import { GAME_IDS, GAME_REGISTRY, getGameDefinition, isGameId, listGames } from "../src/index.js";

const CAPABILITIES = [
  "mods",
  "players",
  "plugins",
  "resources",
  "rules",
  "srv",
  "summary",
] as const;
const SUPPORT_LEVELS = new Set(["conditional", "supported", "unsupported"]);

describe("game registry", () => {
  it("contains every initial game exactly once", () => {
    expect(GAME_IDS).toEqual([
      "rust",
      "project-zomboid",
      "7-days-to-die",
      "minecraft-java",
      "minecraft-bedrock",
      "fivem",
    ]);
    expect(new Set(GAME_IDS).size).toBe(GAME_IDS.length);
    expect(Object.keys(GAME_REGISTRY).sort()).toEqual([...GAME_IDS].sort());
  });

  it("provides valid metadata for every game", () => {
    for (const game of GAME_IDS) {
      const definition = GAME_REGISTRY[game];

      expect(definition.id).toBe(game);
      expect(definition.name.length).toBeGreaterThan(0);
      expect(Number.isInteger(definition.defaultPort)).toBe(true);
      expect(definition.defaultPort).toBeGreaterThan(0);
      expect(definition.defaultPort).toBeLessThanOrEqual(65_535);
      if (definition.defaultQueryPort !== undefined) {
        expect(Number.isInteger(definition.defaultQueryPort)).toBe(true);
        expect(definition.defaultQueryPort).toBeGreaterThan(0);
        expect(definition.defaultQueryPort).toBeLessThanOrEqual(65_535);
      }
      expect(Object.keys(definition.capabilities).sort()).toEqual(CAPABILITIES);
      expect(
        Object.values(definition.capabilities).every((level) => SUPPORT_LEVELS.has(level)),
      ).toBe(true);
    }
  });

  it("looks up definitions without losing their game identity", () => {
    expect(getGameDefinition("rust")).toEqual(GAME_REGISTRY.rust);
    expect(getGameDefinition("rust").defaultQueryPort).toBe(28_017);
    expect(getGameDefinition("project-zomboid")).toMatchObject({
      defaultPort: 16_261,
      capabilities: { summary: "supported", players: "conditional", mods: "conditional" },
    });
    expect(getGameDefinition("7-days-to-die")).toMatchObject({
      defaultPort: 26_900,
      capabilities: { summary: "supported", players: "conditional", rules: "conditional" },
    });
    expect(getGameDefinition("minecraft-java").defaultPort).toBe(25_565);
  });

  it("recognizes only registered game IDs", () => {
    expect(isGameId("fivem")).toBe(true);
    expect(isGameId("counter-strike")).toBe(false);
  });

  it("lists games in the documented registry order", () => {
    expect(listGames().map(({ id }) => id)).toEqual(GAME_IDS);
  });
});
