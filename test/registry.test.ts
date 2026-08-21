import { describe, expect, it } from "vitest";

import {
  canonicalGameId,
  GAME_ALIASES,
  GAME_IDS,
  GAME_REGISTRY,
  getGameDefinition,
  isGameAlias,
  isGameId,
  isGameInputId,
  listGames,
} from "../src/index.js";

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

  it("resolves aliases without adding duplicate registry identities", () => {
    expect(GAME_ALIASES).toEqual({
      zomboid: "project-zomboid",
      pz: "project-zomboid",
      projectzomboid: "project-zomboid",
      "seven-days-to-die": "7-days-to-die",
      "7days-to-die": "7-days-to-die",
      "7d2d": "7-days-to-die",
      "7dtd": "7-days-to-die",
      minecraft: "minecraft-java",
      mc: "minecraft-java",
      java: "minecraft-java",
      "minecraft-java-edition": "minecraft-java",
      bedrock: "minecraft-bedrock",
      mcbe: "minecraft-bedrock",
      "mc-bedrock": "minecraft-bedrock",
      "minecraft-bedrock-edition": "minecraft-bedrock",
      "five-m": "fivem",
    });
    expect(isGameAlias("7d2d")).toBe(true);
    expect(isGameAlias("7-days-to-die")).toBe(false);
    expect(isGameInputId("seven-days-to-die")).toBe(true);
    expect(isGameInputId("counter-strike")).toBe(false);
    expect(canonicalGameId("7d2d")).toBe("7-days-to-die");
    expect(canonicalGameId("7-days-to-die")).toBe("7-days-to-die");
    for (const alias of Object.keys(GAME_ALIASES)) {
      expect(isGameId(alias)).toBe(false);
      if (!isGameAlias(alias)) {
        throw new Error("The alias registry exposed an unrecognized key.");
      }
      const canonical = GAME_ALIASES[alias];
      expect(isGameId(canonical)).toBe(true);
      expect(canonicalGameId(alias)).toBe(canonical);
    }
    expect(getGameDefinition("zomboid")).toBe(GAME_REGISTRY["project-zomboid"]);
    expect(getGameDefinition("mcbe")).toBe(GAME_REGISTRY["minecraft-bedrock"]);
  });

  it("lists games in the documented registry order", () => {
    expect(listGames().map(({ id }) => id)).toEqual(GAME_IDS);
  });
});
