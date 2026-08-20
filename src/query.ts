/** Typed query inputs and discriminated game-specific result contracts. */

import type {
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

/** Every game identifier supported by the typed public contract. */
export type GameId = keyof GameDataMap;

/** Input accepted by the future `query()` entry point. */
export interface QueryInput<G extends GameId = GameId> {
  readonly game: G;
  /** DNS hostname or IP literal. URL syntax is intentionally not accepted. */
  readonly host: string;
  /** Primary game/query port; the profile default is used when omitted. */
  readonly port?: number;
  /** Optional secondary query port for profiles that support one. */
  readonly queryPort?: number;
  readonly mode?: QueryMode;
  /** Global deadline shared by discovery and every protocol source. */
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
  /** True when the required source succeeded but optional enrichment did not. */
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
export type QueryResult<G extends GameId = GameId> = G extends GameId
  ? QuerySuccess<G> | QueryFailure<G>
  : never;
