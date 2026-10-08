/** Exhaustive public game metadata shared by every QueryHost consumer. */

import type {
  CanonicalGameId,
  GameAlias,
  GameAliasMap,
  GameId,
  GameInputId,
  GameProtocolMap,
} from "./query.js";

/** Whether a capability is guaranteed, source-dependent, or unavailable for a profile. */
export type SupportLevel = "supported" | "conditional" | "unsupported";

/** Features exposed through normalized or game-specific query results. */
export type GameCapability =
  "summary" | "players" | "rules" | "mods" | "plugins" | "resources" | "srv";

/**
 * Protocol family of a game profile. `a2s-unreal` marks A2S profiles that also decode Unreal Engine
 * session values, such as the build ID and session flags, from keywords and Rules.
 */
export type GameProtocol =
  | "a2s"
  | "a2s-unreal"
  | "minecraft-java"
  | "minecraft-bedrock"
  | "cfx"
  | "satisfactory"
  | "vintage-story";

/** Static metadata for one supported game profile. */
export interface GameDefinition<G extends GameId = GameId> {
  readonly id: G;
  readonly name: string;
  /**
   * Protocol the profile queries. A game with no game-specific interpretation is queried through
   * its protocol's shared profile, so an A2S game can be added with only its definition.
   */
  readonly protocol: GameProtocolMap[G];
  /** Default game or service port; omitted when the profile cannot infer one. */
  readonly defaultPort?: number;
  /**
   * Conventional query port corresponding to `defaultPort` when the protocol uses a separate
   * destination. Custom game ports preserve the offset unless `queryPortStrategy` is `fixed`.
   */
  readonly defaultQueryPort?: number;
  /** Whether a custom game port shifts the conventional query port or leaves it fixed. */
  readonly queryPortStrategy?: "offset" | "fixed";
  readonly capabilities: Readonly<Record<GameCapability, SupportLevel>>;
}

/** Exhaustive registry shape: every {@link GameId} must have exactly one definition. */
export type GameRegistry = {
  readonly [G in GameId]: GameDefinition<G>;
};

/** Stable presentation order for supported games. */
export const GAME_IDS: readonly [
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
  "ark-survival-evolved",
  "conan-exiles",
  "killing-floor-2",
  "day-of-dragons",
  "soulmask",
  "sons-of-the-forest",
  "icarus",
  "abiotic-factor",
  "arma-3",
  "american-truck-simulator",
  "euro-truck-simulator-2",
  "the-forest",
  "unturned",
  "enshrouded",
  "insurgency-sandstorm",
  "arma-reforger",
  "starbound",
  "space-engineers",
  "humanitz",
  "v-rising",
] = [
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
  "ark-survival-evolved",
  "conan-exiles",
  "killing-floor-2",
  "day-of-dragons",
  "soulmask",
  "sons-of-the-forest",
  "icarus",
  "abiotic-factor",
  "arma-3",
  "american-truck-simulator",
  "euro-truck-simulator-2",
  "the-forest",
  "unturned",
  "enshrouded",
  "insurgency-sandstorm",
  "arma-reforger",
  "starbound",
  "space-engineers",
  "humanitz",
  "v-rising",
] as const;

/** Accepted aliases keyed by their alternate spelling. Values always remain canonical IDs. */
export const GAME_ALIASES: GameAliasMap = Object.freeze({
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
  ark: "ark-survival-evolved",
  arkse: "ark-survival-evolved",
  ase: "ark-survival-evolved",
  conan: "conan-exiles",
  conanexiles: "conan-exiles",
  kf2: "killing-floor-2",
  killingfloor2: "killing-floor-2",
  dayofdragons: "day-of-dragons",
  sotf: "sons-of-the-forest",
  sonsoftheforest: "sons-of-the-forest",
  abioticfactor: "abiotic-factor",
  arma3: "arma-3",
  a3: "arma-3",
  ats: "american-truck-simulator",
  americantrucksimulator: "american-truck-simulator",
  ets2: "euro-truck-simulator-2",
  eurotrucksimulator2: "euro-truck-simulator-2",
  theforest: "the-forest",
  sandstorm: "insurgency-sandstorm",
  insurgencysandstorm: "insurgency-sandstorm",
  armareforger: "arma-reforger",
  reforger: "arma-reforger",
  spaceengineers: "space-engineers",
  vrising: "v-rising",
});

/** Steam A2S games whose Player and Rules answers depend on server configuration or build. */
const STEAM_A2S_CAPABILITIES: GameDefinition["capabilities"] = Object.freeze({
  summary: "supported",
  players: "conditional",
  rules: "conditional",
  mods: "unsupported",
  plugins: "unsupported",
  resources: "unsupported",
  srv: "unsupported",
});

/**
 * Single source of truth consumed by the library and, later, the API, documentation, and website.
 */
export const GAME_REGISTRY: GameRegistry = {
  a2s: {
    id: "a2s",
    name: "Generic A2S",
    protocol: "a2s",
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
  "dont-starve-together": {
    id: "dont-starve-together",
    name: "Don't Starve Together",
    protocol: "a2s",
    defaultPort: 10_999,
    defaultQueryPort: 27_016,
    queryPortStrategy: "fixed",
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
  rust: {
    id: "rust",
    name: "Rust",
    protocol: "a2s",
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
  palworld: {
    id: "palworld",
    name: "Palworld",
    protocol: "a2s",
    defaultPort: 8211,
    defaultQueryPort: 27015,
    queryPortStrategy: "fixed",
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
    protocol: "a2s",
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
    protocol: "a2s",
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
  dayz: {
    id: "dayz",
    name: "DayZ",
    protocol: "a2s",
    defaultPort: 2302,
    defaultQueryPort: 2305,
    capabilities: {
      summary: "supported",
      players: "unsupported",
      rules: "conditional",
      mods: "conditional",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  valheim: {
    id: "valheim",
    name: "Valheim",
    protocol: "a2s",
    defaultPort: 2456,
    defaultQueryPort: 2457,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "unsupported",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "minecraft-java": {
    id: "minecraft-java",
    name: "Minecraft: Java Edition",
    protocol: "minecraft-java",
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
    protocol: "minecraft-bedrock",
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
    protocol: "cfx",
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
  redm: {
    id: "redm",
    name: "RedM",
    protocol: "cfx",
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
  satisfactory: {
    id: "satisfactory",
    name: "Satisfactory",
    protocol: "satisfactory",
    defaultPort: 7777,
    capabilities: {
      summary: "supported",
      players: "unsupported",
      rules: "unsupported",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "vintage-story": {
    id: "vintage-story",
    name: "Vintage Story",
    protocol: "vintage-story",
    defaultPort: 42420,
    capabilities: {
      summary: "supported",
      players: "conditional",
      rules: "unsupported",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "counter-strike-2": {
    id: "counter-strike-2",
    name: "Counter-Strike 2",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "counter-strike-source": {
    id: "counter-strike-source",
    name: "Counter-Strike: Source",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "team-fortress-2": {
    id: "team-fortress-2",
    name: "Team Fortress 2",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "left-4-dead": {
    id: "left-4-dead",
    name: "Left 4 Dead",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "left-4-dead-2": {
    id: "left-4-dead-2",
    name: "Left 4 Dead 2",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "garrys-mod": {
    id: "garrys-mod",
    name: "Garry's Mod",
    protocol: "a2s",
    defaultPort: 27015,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "ark-survival-evolved": {
    id: "ark-survival-evolved",
    name: "ARK: Survival Evolved",
    protocol: "a2s-unreal",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: Object.freeze({ ...STEAM_A2S_CAPABILITIES, mods: "conditional" }),
  },
  "conan-exiles": {
    id: "conan-exiles",
    name: "Conan Exiles",
    protocol: "a2s-unreal",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: {
      summary: "supported",
      players: "unsupported",
      rules: "conditional",
      mods: "unsupported",
      plugins: "unsupported",
      resources: "unsupported",
      srv: "unsupported",
    },
  },
  "killing-floor-2": {
    id: "killing-floor-2",
    name: "Killing Floor 2",
    protocol: "a2s",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "day-of-dragons": {
    id: "day-of-dragons",
    name: "Day of Dragons",
    protocol: "a2s-unreal",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  soulmask: {
    id: "soulmask",
    name: "Soulmask",
    protocol: "a2s-unreal",
    defaultPort: 8777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "sons-of-the-forest": {
    id: "sons-of-the-forest",
    name: "Sons of the Forest",
    protocol: "a2s",
    defaultPort: 8766,
    defaultQueryPort: 27_016,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  icarus: {
    id: "icarus",
    name: "Icarus",
    protocol: "a2s-unreal",
    defaultPort: 17_777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "abiotic-factor": {
    id: "abiotic-factor",
    name: "Abiotic Factor",
    protocol: "a2s-unreal",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "arma-3": {
    id: "arma-3",
    name: "Arma 3",
    protocol: "a2s",
    defaultPort: 2302,
    defaultQueryPort: 2303,
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
  "american-truck-simulator": {
    id: "american-truck-simulator",
    name: "American Truck Simulator",
    protocol: "a2s",
    defaultPort: 27_015,
    defaultQueryPort: 27_016,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "euro-truck-simulator-2": {
    id: "euro-truck-simulator-2",
    name: "Euro Truck Simulator 2",
    protocol: "a2s",
    defaultPort: 27_015,
    defaultQueryPort: 27_016,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "the-forest": {
    id: "the-forest",
    name: "The Forest",
    protocol: "a2s",
    defaultPort: 27_015,
    defaultQueryPort: 27_016,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  unturned: {
    id: "unturned",
    name: "Unturned",
    protocol: "a2s",
    defaultPort: 27_015,
    capabilities: Object.freeze({
      ...STEAM_A2S_CAPABILITIES,
      mods: "conditional",
      plugins: "conditional",
    }),
  },
  enshrouded: {
    id: "enshrouded",
    name: "Enshrouded",
    protocol: "a2s",
    defaultPort: 15_637,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "insurgency-sandstorm": {
    id: "insurgency-sandstorm",
    name: "Insurgency: Sandstorm",
    protocol: "a2s-unreal",
    defaultPort: 27_102,
    defaultQueryPort: 27_131,
    queryPortStrategy: "fixed",
    capabilities: Object.freeze({ ...STEAM_A2S_CAPABILITIES, mods: "conditional" }),
  },
  "arma-reforger": {
    id: "arma-reforger",
    name: "Arma Reforger",
    protocol: "a2s",
    defaultPort: 2001,
    defaultQueryPort: 17_777,
    queryPortStrategy: "fixed",
    capabilities: Object.freeze({ ...STEAM_A2S_CAPABILITIES, players: "unsupported" }),
  },
  starbound: {
    id: "starbound",
    name: "Starbound",
    protocol: "a2s",
    defaultPort: 21_025,
    defaultQueryPort: 21_025,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "space-engineers": {
    id: "space-engineers",
    name: "Space Engineers",
    protocol: "a2s",
    defaultPort: 27_016,
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  humanitz: {
    id: "humanitz",
    name: "HumanitZ",
    protocol: "a2s-unreal",
    defaultPort: 7777,
    defaultQueryPort: 27_015,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
  },
  "v-rising": {
    id: "v-rising",
    name: "V Rising",
    protocol: "a2s",
    defaultPort: 9876,
    defaultQueryPort: 9877,
    queryPortStrategy: "fixed",
    capabilities: STEAM_A2S_CAPABILITIES,
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
