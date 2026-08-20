/** Exhaustive supported-game metadata shared by every QueryHost consumer. */

import type { GameId } from "./query.js";

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
      mods: "unsupported",
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
      players: "conditional",
      rules: "conditional",
      mods: "conditional",
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

/** Looks up a definition without widening its literal game identifier. */
export function getGameDefinition<G extends GameId>(game: G): GameDefinition<G> {
  return GAME_REGISTRY[game];
}

/** Lists game definitions in the stable order defined by {@link GAME_IDS}. */
export function listGames(): readonly GameDefinition[] {
  return GAME_IDS.map((game) => GAME_REGISTRY[game]);
}
