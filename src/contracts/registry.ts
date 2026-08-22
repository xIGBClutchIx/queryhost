/** Exhaustive public game metadata shared by every QueryHost consumer. */

import type { CanonicalGameId, GameAlias, GameAliasMap, GameId, GameInputId } from "./query.js";

/** Whether a capability is guaranteed, source-dependent, or unavailable for a profile. */
export type SupportLevel = "supported" | "conditional" | "unsupported";

/** Features exposed through normalized or game-specific query results. */
export type GameCapability =
  "summary" | "players" | "rules" | "mods" | "plugins" | "resources" | "srv";

/** Static metadata for one supported game profile. */
export interface GameDefinition<G extends GameId = GameId> {
  readonly id: G;
  readonly name: string;
  /** Default game or service port supplied by users. */
  readonly defaultPort: number;
  /**
   * Conventional query port corresponding to `defaultPort` when the protocol uses a separate
   * destination. QueryHost preserves this offset for custom game ports.
   */
  readonly defaultQueryPort?: number;
  readonly capabilities: Readonly<Record<GameCapability, SupportLevel>>;
}

/** Exhaustive registry shape: every {@link GameId} must have exactly one definition. */
export type GameRegistry = {
  readonly [G in GameId]: GameDefinition<G>;
};

/** Stable presentation order for supported games. */
export const GAME_IDS: readonly [
  "rust",
  "project-zomboid",
  "7-days-to-die",
  "minecraft-java",
  "minecraft-bedrock",
  "fivem",
] = [
  "rust",
  "project-zomboid",
  "7-days-to-die",
  "minecraft-java",
  "minecraft-bedrock",
  "fivem",
] as const;

/** Accepted aliases keyed by their alternate spelling. Values always remain canonical IDs. */
export const GAME_ALIASES: GameAliasMap = Object.freeze({
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

/**
 * Single source of truth consumed by the library and, later, the API, documentation, and website.
 */
export const GAME_REGISTRY: GameRegistry = {
  rust: {
    id: "rust",
    name: "Rust",
    defaultPort: 28015,
    defaultQueryPort: 28017,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "conditional",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "project-zomboid": {
    id: "project-zomboid",
    name: "Project Zomboid",
    defaultPort: 16261,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "conditional",
      mods: "conditional",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "7-days-to-die": {
    id: "7-days-to-die",
    name: "7 Days to Die",
    defaultPort: 26900,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "conditional",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "minecraft-java": {
    id: "minecraft-java",
    name: "Minecraft: Java Edition",
    defaultPort: 25565,
    capabilities: {
      summary: "supported",
      players: "supported",
      rules: "unsupported",
      mods: "unsupported",
      plugins: "conditional",
      resources: "unsupported",
      srv: "conditional",
    },
  },
  "minecraft-bedrock": {
    id: "minecraft-bedrock",
    name: "Minecraft: Bedrock Edition",
    defaultPort: 19132,
    capabilities: {
      summary: "supported",
      players: "supported",
      rules: "unsupported",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  fivem: {
    id: "fivem",
    name: "FiveM",
    defaultPort: 30120,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "conditional",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "conditional",
      srv: "unsupported",
    },
  },
};

/** Returns whether an arbitrary string is a registered game identifier. */
export function isGameId(value: string): value is GameId {
  return Object.hasOwn(GAME_REGISTRY, value);
}

/** Returns whether a string is a registered alias. */
export function isGameAlias(value: string): value is GameAlias {
  return Object.hasOwn(GAME_ALIASES, value);
}

/** Returns whether a string is accepted as a canonical or aliased query identifier. */
export function isGameInputId(value: string): value is GameInputId {
  return isGameId(value) || isGameAlias(value);
}

/** Resolves an accepted input identifier to the single canonical result identifier. */
export function canonicalGameId<G extends GameInputId>(game: G): CanonicalGameId<G> {
  return (isGameId(game) ? game : aliasGameId(game)) as CanonicalGameId<G>;
}

function aliasGameId(alias: GameAlias): GameId {
  return GAME_ALIASES[alias];
}

/** Looks up a canonical or aliased definition without widening its canonical identity. */
export function getGameDefinition<G extends GameInputId>(
  game: G,
): GameDefinition<CanonicalGameId<G>> {
  return GAME_REGISTRY[canonicalGameId(game)];
}

/** Lists game definitions in the stable order defined by {@link GAME_IDS}. */
export function listGames(): readonly GameDefinition[] {
  return GAME_IDS.map((game) => GAME_REGISTRY[game]);
}
