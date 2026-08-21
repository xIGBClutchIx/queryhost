/** Typed query inputs and discriminated game-specific result contracts. */

import type {
  A2sRawData,
  FiveMData,
  MinecraftBedrockData,
  MinecraftJavaData,
  ProjectZomboidData,
  RustData,
  SevenDaysToDieData,
} from "./games.js";
import type { QueryError, QueryMode, QuerySource, QueryWarning, ServerInfo } from "./shared.js";

/**
 * Associates each game ID with its stable game-specific result shape.
 *
 * Adding a game here forces the registry and callers using exhaustive switches to handle it.
 */
export interface GameDataMap {
  readonly rust: RustData;
  readonly "project-zomboid": ProjectZomboidData;
  readonly "7-days-to-die": SevenDaysToDieData;
  readonly "minecraft-java": MinecraftJavaData;
  readonly "minecraft-bedrock": MinecraftBedrockData;
  readonly fivem: FiveMData;
}

/** Associates implemented games with their untouched protocol payloads. */
export interface GameRawDataMap {
  readonly rust: A2sRawData;
  readonly "project-zomboid": A2sRawData;
  readonly "7-days-to-die": A2sRawData;
  readonly "minecraft-java": never;
  readonly "minecraft-bedrock": never;
  readonly fivem: never;
}

/** Every game identifier supported by the typed public contract. */
export type GameId = keyof GameDataMap;

/** Alternate input spellings mapped to one stable game identity. */
export interface GameAliasMap {
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

/** Input accepted by the public `query()` entry point. */
export interface QueryInput<G extends GameInputId = GameInputId> {
  readonly game: G;
  /** DNS hostname or IP literal. URL syntax is intentionally not accepted. */
  readonly host: string;
  /** Primary game or service port; the profile default is used when omitted. */
  readonly port?: number;
  /** Explicit protocol query port, overriding the profile convention derived from `port`. */
  readonly queryPort?: number;
  readonly mode?: QueryMode;
  /** Global deadline from 1 through 30,000 ms; defaults to 5,000 ms. */
  readonly timeoutMs?: number;
  /** Caller cancellation propagated to every outstanding operation. */
  readonly signal?: AbortSignal;
}

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
type QuerySuccessFor<G extends GameId> = G extends GameId ? QuerySuccess<G> : never;

/** Success remains correlated by game; failure needs no game-specific data correlation. */
export type QueryResult<G extends GameId = GameId> = QuerySuccessFor<G> | QueryFailure<G>;
