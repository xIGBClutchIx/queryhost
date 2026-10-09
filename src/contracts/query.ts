/** Public query inputs and discriminated game-specific result contracts. */

import type {
  Arma3Data,
  Arma3RawData,
  AmericanTruckSimulatorData,
  EuroTruckSimulator2Data,
  TheForestData,
  UnturnedData,
  EnshroudedData,
  InsurgencySandstormData,
  ArmaReforgerData,
  StarboundData,
  SpaceEngineersData,
  HumanitZData,
  VRisingData,
  VeinData,
  AvorionData,
  ArkSurvivalEvolvedData,
  ConanExilesData,
  KillingFloor2Data,
  DayOfDragonsData,
  SoulmaskData,
  SonsOfTheForestData,
  IcarusData,
  AbioticFactorData,
  A2sData,
  A2sRawData,
  CounterStrike2Data,
  CounterStrikeSourceData,
  DayZData,
  DayZRawData,
  DontStarveTogetherData,
  FiveMData,
  GarrysModData,
  Left4Dead2Data,
  Left4DeadData,
  MinecraftBedrockData,
  MinecraftJavaData,
  PalworldData,
  ProjectZomboidData,
  RedMData,
  RustData,
  SevenDaysToDieData,
  SatisfactoryData,
  SatisfactoryRawData,
  TeamFortress2Data,
  VintageStoryData,
  ValheimData,
  EcoData,
  EcoRawData,
} from "./games.js";
import type { QueryError, QueryMode, QuerySource, QueryWarning, ServerInfo } from "./shared.js";

/**
 * Associates each game ID with its stable game-specific result shape.
 *
 * Adding a game here forces the registry and callers using exhaustive switches to handle it.
 */
export interface GameDataMap {
  readonly a2s: A2sData;
  readonly "dont-starve-together": DontStarveTogetherData;
  readonly rust: RustData;
  readonly palworld: PalworldData;
  readonly "project-zomboid": ProjectZomboidData;
  readonly "7-days-to-die": SevenDaysToDieData;
  readonly dayz: DayZData;
  readonly valheim: ValheimData;
  readonly "minecraft-java": MinecraftJavaData;
  readonly "minecraft-bedrock": MinecraftBedrockData;
  readonly fivem: FiveMData;
  readonly redm: RedMData;
  readonly satisfactory: SatisfactoryData;
  readonly "vintage-story": VintageStoryData;
  readonly "counter-strike-2": CounterStrike2Data;
  readonly "counter-strike-source": CounterStrikeSourceData;
  readonly "team-fortress-2": TeamFortress2Data;
  readonly "left-4-dead": Left4DeadData;
  readonly "left-4-dead-2": Left4Dead2Data;
  readonly "garrys-mod": GarrysModData;
  readonly "ark-survival-evolved": ArkSurvivalEvolvedData;
  readonly "conan-exiles": ConanExilesData;
  readonly "killing-floor-2": KillingFloor2Data;
  readonly "day-of-dragons": DayOfDragonsData;
  readonly soulmask: SoulmaskData;
  readonly "sons-of-the-forest": SonsOfTheForestData;
  readonly icarus: IcarusData;
  readonly "abiotic-factor": AbioticFactorData;
  readonly "arma-3": Arma3Data;
  readonly "american-truck-simulator": AmericanTruckSimulatorData;
  readonly "euro-truck-simulator-2": EuroTruckSimulator2Data;
  readonly "the-forest": TheForestData;
  readonly unturned: UnturnedData;
  readonly enshrouded: EnshroudedData;
  readonly "insurgency-sandstorm": InsurgencySandstormData;
  readonly "arma-reforger": ArmaReforgerData;
  readonly starbound: StarboundData;
  readonly "space-engineers": SpaceEngineersData;
  readonly humanitz: HumanitZData;
  readonly "v-rising": VRisingData;
  readonly eco: EcoData;
  readonly vein: VeinData;
  readonly avorion: AvorionData;
}

/** Associates implemented games with their untouched protocol payloads. */
export interface GameRawDataMap {
  readonly a2s: A2sRawData;
  readonly "dont-starve-together": A2sRawData;
  readonly rust: A2sRawData;
  readonly palworld: A2sRawData;
  readonly "project-zomboid": A2sRawData;
  readonly "7-days-to-die": A2sRawData;
  readonly dayz: DayZRawData;
  readonly valheim: never;
  readonly "minecraft-java": never;
  readonly "minecraft-bedrock": never;
  readonly fivem: never;
  readonly redm: never;
  readonly satisfactory: SatisfactoryRawData;
  readonly "vintage-story": never;
  readonly "counter-strike-2": A2sRawData;
  readonly "counter-strike-source": A2sRawData;
  readonly "team-fortress-2": A2sRawData;
  readonly "left-4-dead": A2sRawData;
  readonly "left-4-dead-2": A2sRawData;
  readonly "garrys-mod": A2sRawData;
  readonly "ark-survival-evolved": A2sRawData;
  readonly "conan-exiles": A2sRawData;
  readonly "killing-floor-2": A2sRawData;
  readonly "day-of-dragons": A2sRawData;
  readonly soulmask: A2sRawData;
  readonly "sons-of-the-forest": A2sRawData;
  readonly icarus: A2sRawData;
  readonly "abiotic-factor": A2sRawData;
  readonly "arma-3": Arma3RawData;
  readonly "american-truck-simulator": A2sRawData;
  readonly "euro-truck-simulator-2": A2sRawData;
  readonly "the-forest": A2sRawData;
  readonly unturned: A2sRawData;
  readonly enshrouded: A2sRawData;
  readonly "insurgency-sandstorm": A2sRawData;
  readonly "arma-reforger": A2sRawData;
  readonly starbound: A2sRawData;
  readonly "space-engineers": A2sRawData;
  readonly humanitz: A2sRawData;
  readonly "v-rising": A2sRawData;
  readonly eco: EcoRawData;
  readonly vein: A2sRawData;
  readonly avorion: A2sRawData;
}

/**
 * Associates each game with the protocol family its registry definition declares. A game whose
 * profile is its protocol's shared A2S profile must have exactly that profile's data shape.
 */
export interface GameProtocolMap {
  readonly a2s: "a2s";
  readonly "dont-starve-together": "a2s";
  readonly rust: "a2s";
  readonly palworld: "a2s";
  readonly "project-zomboid": "a2s";
  readonly "7-days-to-die": "a2s";
  readonly dayz: "a2s";
  readonly valheim: "a2s";
  readonly "minecraft-java": "minecraft-java";
  readonly "minecraft-bedrock": "minecraft-bedrock";
  readonly fivem: "cfx";
  readonly redm: "cfx";
  readonly satisfactory: "satisfactory";
  readonly "vintage-story": "vintage-story";
  readonly "counter-strike-2": "a2s";
  readonly "counter-strike-source": "a2s";
  readonly "team-fortress-2": "a2s";
  readonly "left-4-dead": "a2s";
  readonly "left-4-dead-2": "a2s";
  readonly "garrys-mod": "a2s";
  readonly "ark-survival-evolved": "a2s-unreal";
  readonly "conan-exiles": "a2s-unreal";
  readonly "killing-floor-2": "a2s";
  readonly "day-of-dragons": "a2s-unreal";
  readonly soulmask: "a2s-unreal";
  readonly "sons-of-the-forest": "a2s";
  readonly icarus: "a2s-unreal";
  readonly "abiotic-factor": "a2s-unreal";
  readonly "arma-3": "a2s";
  readonly "american-truck-simulator": "a2s";
  readonly "euro-truck-simulator-2": "a2s";
  readonly "the-forest": "a2s";
  readonly unturned: "a2s";
  readonly enshrouded: "a2s";
  readonly "insurgency-sandstorm": "a2s-unreal";
  readonly "arma-reforger": "a2s";
  readonly starbound: "a2s";
  readonly "space-engineers": "a2s";
  readonly humanitz: "a2s-unreal";
  readonly "v-rising": "a2s";
  readonly eco: "eco";
  readonly vein: "a2s";
  readonly avorion: "a2s";
}

/** Every game identifier supported by the typed public contract. */
export type GameId = keyof GameDataMap;

/** Alternate input spellings mapped to one stable game identity. */
export interface GameAliasMap {
  readonly dst: "dont-starve-together";
  readonly dontstarvetogether: "dont-starve-together";
  readonly zomboid: "project-zomboid";
  readonly pz: "project-zomboid";
  readonly projectzomboid: "project-zomboid";
  readonly "seven-days-to-die": "7-days-to-die";
  readonly "7days-to-die": "7-days-to-die";
  readonly "7d2d": "7-days-to-die";
  readonly "7dtd": "7-days-to-die";
  readonly minecraft: "minecraft-java";
  readonly mc: "minecraft-java";
  readonly java: "minecraft-java";
  readonly "minecraft-java-edition": "minecraft-java";
  readonly bedrock: "minecraft-bedrock";
  readonly mcbe: "minecraft-bedrock";
  readonly "mc-bedrock": "minecraft-bedrock";
  readonly "minecraft-bedrock-edition": "minecraft-bedrock";
  readonly "five-m": "fivem";
  readonly "red-m": "redm";
  readonly rdr3: "redm";
  readonly vintagestory: "vintage-story";
  readonly vs: "vintage-story";
  readonly cs2: "counter-strike-2";
  readonly counterstrike2: "counter-strike-2";
  readonly css: "counter-strike-source";
  readonly "cs-source": "counter-strike-source";
  readonly counterstrikesource: "counter-strike-source";
  readonly tf2: "team-fortress-2";
  readonly teamfortress2: "team-fortress-2";
  readonly l4d: "left-4-dead";
  readonly left4dead: "left-4-dead";
  readonly l4d2: "left-4-dead-2";
  readonly left4dead2: "left-4-dead-2";
  readonly gmod: "garrys-mod";
  readonly garrysmod: "garrys-mod";
  readonly ark: "ark-survival-evolved";
  readonly arkse: "ark-survival-evolved";
  readonly ase: "ark-survival-evolved";
  readonly conan: "conan-exiles";
  readonly conanexiles: "conan-exiles";
  readonly kf2: "killing-floor-2";
  readonly killingfloor2: "killing-floor-2";
  readonly dayofdragons: "day-of-dragons";
  readonly sotf: "sons-of-the-forest";
  readonly sonsoftheforest: "sons-of-the-forest";
  readonly abioticfactor: "abiotic-factor";
  readonly arma3: "arma-3";
  readonly a3: "arma-3";
  readonly ats: "american-truck-simulator";
  readonly americantrucksimulator: "american-truck-simulator";
  readonly ets2: "euro-truck-simulator-2";
  readonly eurotrucksimulator2: "euro-truck-simulator-2";
  readonly theforest: "the-forest";
  readonly sandstorm: "insurgency-sandstorm";
  readonly insurgencysandstorm: "insurgency-sandstorm";
  readonly armareforger: "arma-reforger";
  readonly reforger: "arma-reforger";
  readonly spaceengineers: "space-engineers";
  readonly vrising: "v-rising";
}

/** Accepted non-canonical game identifier. */
export type GameAlias = keyof GameAliasMap;

/** Every canonical or aliased identifier accepted as query input. */
export type GameInputId = GameId | GameAlias;

/** Canonical result identifier selected by a query input identifier. */
export type CanonicalGameId<G extends GameInputId> = G extends GameId
  ? G
  : G extends GameAlias
    ? GameAliasMap[G]
    : never;

/** Input accepted by the public `query()` entry point. Generic A2S requires its query port. */
export type QueryInput<G extends GameInputId = GameInputId> = {
  readonly game: G;
  /** DNS hostname or IP literal. URL syntax is intentionally not accepted. */
  readonly host: string;
  readonly mode?: QueryMode;
  /** Global deadline from 1 through 30,000 ms; defaults to 5,000 ms. */
  readonly timeoutMs?: number;
  /** Caller cancellation propagated to every outstanding operation. */
  readonly signal?: AbortSignal;
} & (CanonicalGameId<G> extends "a2s"
  ? {
      /** Actual A2S query destination; generic A2S has no inferred default. */
      readonly port: number;
      readonly queryPort?: never;
    }
  : {
      /** Primary game or service port; the profile default is used when omitted. */
      readonly port?: number;
      /** Explicit protocol query port, overriding the profile convention derived from `port`. */
      readonly queryPort?: number;
    });

/** Fields present on both successful and failed queries. */
interface QueryResultBase<G extends GameId> {
  readonly game: G;
  /** Total wall-clock duration across discovery and all attempted sources. */
  readonly durationMs: number;
  /** Source-by-source provenance, including skipped and failed optional work. */
  readonly sources: readonly QuerySource[];
  readonly warnings: readonly QueryWarning[];
}

/** Successful query with normalized and game-specific data. */
export interface QuerySuccess<G extends GameId> extends QueryResultBase<G> {
  readonly ok: true;
  readonly server: ServerInfo;
  /** Data whose type is selected by the literal `game` identifier. */
  readonly data: GameDataMap[G];
  /** Untouched protocol fields, kept separate from normalized data. */
  readonly rawData?: GameRawDataMap[G];
  /** True when the profile produced a usable result but requested enrichment remained incomplete. */
  readonly partial: boolean;
}

/** Failed query in which a required source could not produce a usable result. */
export interface QueryFailure<G extends GameId> extends QueryResultBase<G> {
  readonly ok: false;
  readonly error: QueryError;
}

/**
 * Discriminated query result that preserves game-specific narrowing for both literal and dynamic
 * game identifiers.
 */
/** Success remains correlated by game; failure needs no game-specific data correlation. */
export type QueryResult<G extends GameId = GameId> =
  (G extends GameId ? QuerySuccess<G> : never) | QueryFailure<G>;
