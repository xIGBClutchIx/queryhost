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
} from "../../src/index.js";

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
      "a2s",
      "dont-starve-together",
      "rust",
      "palworld",
      "project-zomboid",
      "7-days-to-die",
      "dayz",
      "valheim",
      "minecraft-java",
      "minecraft-bedrock",
      "fivem",
      "redm",
      "satisfactory",
      "vintage-story",
      "counter-strike-2",
      "counter-strike-source",
      "team-fortress-2",
      "left-4-dead",
      "left-4-dead-2",
      "garrys-mod",
    ]);
    expect(new Set(GAME_IDS).size).toBe(GAME_IDS.length);
    expect(Object.keys(GAME_REGISTRY).sort()).toEqual([...GAME_IDS].sort());
  });

  it("provides valid metadata for every game", () => {
    for (const game of GAME_IDS) {
      const definition = GAME_REGISTRY[game];

      expect(definition.id).toBe(game);
      expect(definition.name.length).toBeGreaterThan(0);
      if (definition.defaultPort !== undefined) {
        expect(Number.isInteger(definition.defaultPort)).toBe(true);
        expect(definition.defaultPort).toBeGreaterThan(0);
        expect(definition.defaultPort).toBeLessThanOrEqual(65_535);
      }
      if (definition.defaultQueryPort !== undefined) {
        expect(Number.isInteger(definition.defaultQueryPort)).toBe(true);
        expect(definition.defaultQueryPort).toBeGreaterThan(0);
        expect(definition.defaultQueryPort).toBeLessThanOrEqual(65_535);
      }
      if (definition.queryPortStrategy !== undefined) {
        expect(definition.defaultQueryPort).toBeDefined();
        expect(["offset", "fixed"]).toContain(definition.queryPortStrategy);
      }
      expect(Object.keys(definition.capabilities).sort()).toEqual(CAPABILITIES);
      expect(
        Object.values(definition.capabilities).every((level) => SUPPORT_LEVELS.has(level)),
      ).toBe(true);
    }
  });

  it("looks up definitions without losing their game identity", () => {
    expect(getGameDefinition("a2s")).toMatchObject({
      name: "Generic A2S",
      capabilities: { summary: "supported", players: "conditional", rules: "conditional" },
    });
    expect(getGameDefinition("a2s").defaultPort).toBeUndefined();
    expect(getGameDefinition("dont-starve-together")).toMatchObject({
      defaultPort: 10_999,
      defaultQueryPort: 27_016,
      queryPortStrategy: "fixed",
      capabilities: { summary: "supported", players: "conditional", rules: "conditional" },
    });
    expect(getGameDefinition("rust")).toEqual(GAME_REGISTRY.rust);
    expect(getGameDefinition("rust").defaultQueryPort).toBe(28_017);
    expect(getGameDefinition("palworld")).toMatchObject({
      defaultPort: 8_211,
      defaultQueryPort: 27_015,
      queryPortStrategy: "fixed",
      capabilities: { summary: "supported", players: "conditional", rules: "conditional" },
    });
    expect(getGameDefinition("project-zomboid")).toMatchObject({
      defaultPort: 16_261,
      capabilities: { summary: "supported", players: "conditional", mods: "conditional" },
    });
    expect(getGameDefinition("7-days-to-die")).toMatchObject({
      defaultPort: 26_900,
      capabilities: { summary: "supported", players: "conditional", rules: "conditional" },
    });
    expect(getGameDefinition("dayz")).toMatchObject({
      defaultPort: 2302,
      defaultQueryPort: 2305,
      capabilities: {
        summary: "supported",
        players: "unsupported",
        rules: "conditional",
        mods: "conditional",
      },
    });
    expect(getGameDefinition("valheim")).toMatchObject({
      defaultPort: 2456,
      defaultQueryPort: 2457,
      capabilities: { summary: "supported", players: "conditional", rules: "unsupported" },
    });
    expect(getGameDefinition("minecraft-java")).toMatchObject({
      defaultPort: 25_565,
      capabilities: {
        summary: "supported",
        players: "supported",
        rules: "unsupported",
        plugins: "conditional",
        srv: "conditional",
      },
    });
    expect(getGameDefinition("minecraft-bedrock")).toMatchObject({
      defaultPort: 19_132,
      capabilities: {
        summary: "supported",
        players: "supported",
        rules: "unsupported",
        plugins: "unsupported",
        srv: "unsupported",
      },
    });
    expect(getGameDefinition("fivem")).toMatchObject({
      defaultPort: 30_120,
      capabilities: {
        summary: "supported",
        players: "conditional",
        resources: "conditional",
        rules: "conditional",
      },
    });
    expect(getGameDefinition("redm")).toMatchObject({
      defaultPort: 30_120,
      capabilities: {
        summary: "supported",
        players: "conditional",
        resources: "conditional",
        rules: "conditional",
      },
    });
    expect(getGameDefinition("satisfactory")).toMatchObject({
      defaultPort: 7777,
      capabilities: {
        summary: "supported",
        players: "unsupported",
        rules: "unsupported",
      },
    });
    expect(getGameDefinition("vintage-story")).toMatchObject({
      defaultPort: 42_420,
      capabilities: {
        summary: "supported",
        players: "conditional",
        rules: "unsupported",
      },
    });
  });

  it.each([
    ["counter-strike-2", "Counter-Strike 2"],
    ["counter-strike-source", "Counter-Strike: Source"],
    ["team-fortress-2", "Team Fortress 2"],
    ["left-4-dead", "Left 4 Dead"],
    ["left-4-dead-2", "Left 4 Dead 2"],
    ["garrys-mod", "Garry's Mod"],
  ] as const)("queries %s on its 27015 game port", (game, name) => {
    const definition = getGameDefinition(game);

    expect(definition).toMatchObject({
      name,
      defaultPort: 27_015,
      capabilities: {
        summary: "supported",
        players: "conditional",
        rules: "conditional",
        mods: "unsupported",
      },
    });
    expect(definition.defaultQueryPort).toBeUndefined();
    expect(definition.queryPortStrategy).toBeUndefined();
  });

  it("recognizes only registered game IDs", () => {
    expect(isGameId("fivem")).toBe(true);
    expect(isGameId("redm")).toBe(true);
    expect(isGameId("palworld")).toBe(true);
    expect(isGameId("valheim")).toBe(true);
    expect(isGameId("counter-strike")).toBe(false);
  });

  it("resolves aliases without adding duplicate registry identities", () => {
    expect(GAME_ALIASES).toEqual({
      dst: "dont-starve-together",
      dontstarvetogether: "dont-starve-together",
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
      "red-m": "redm",
      rdr3: "redm",
      vintagestory: "vintage-story",
      vs: "vintage-story",
      cs2: "counter-strike-2",
      counterstrike2: "counter-strike-2",
      css: "counter-strike-source",
      "cs-source": "counter-strike-source",
      counterstrikesource: "counter-strike-source",
      tf2: "team-fortress-2",
      teamfortress2: "team-fortress-2",
      l4d: "left-4-dead",
      left4dead: "left-4-dead",
      l4d2: "left-4-dead-2",
      left4dead2: "left-4-dead-2",
      gmod: "garrys-mod",
      garrysmod: "garrys-mod",
    });
    expect(isGameAlias("7d2d")).toBe(true);
    expect(isGameAlias("7-days-to-die")).toBe(false);
    expect(isGameInputId("seven-days-to-die")).toBe(true);
    expect(isGameInputId("counter-strike")).toBe(false);
    expect(canonicalGameId("7d2d")).toBe("7-days-to-die");
    expect(canonicalGameId("dst")).toBe("dont-starve-together");
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
    expect(getGameDefinition("dst")).toBe(GAME_REGISTRY["dont-starve-together"]);
    expect(getGameDefinition("mcbe")).toBe(GAME_REGISTRY["minecraft-bedrock"]);
    expect(getGameDefinition("red-m")).toBe(GAME_REGISTRY.redm);
    expect(getGameDefinition("rdr3")).toBe(GAME_REGISTRY.redm);
    expect(getGameDefinition("vs")).toBe(GAME_REGISTRY["vintage-story"]);
    expect(getGameDefinition("tf2")).toBe(GAME_REGISTRY["team-fortress-2"]);
    expect(getGameDefinition("gmod")).toBe(GAME_REGISTRY["garrys-mod"]);
  });

  it("lists games in the documented registry order", () => {
    expect(listGames().map(({ id }) => id)).toEqual(GAME_IDS);
  });
});
