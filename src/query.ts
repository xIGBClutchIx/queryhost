import type {
  FiveMData,
  MinecraftBedrockData,
  MinecraftJavaData,
  ProjectZomboidData,
  RustData,
  SevenDaysToDieData,
} from "./games.js";
import type { QueryError, QueryMode, QuerySource, QueryWarning, ServerInfo } from "./shared.js";

export interface GameDataMap {
  readonly rust: RustData;
  readonly "project-zomboid": ProjectZomboidData;
  readonly "7-days-to-die": SevenDaysToDieData;
  readonly "minecraft-java": MinecraftJavaData;
  readonly "minecraft-bedrock": MinecraftBedrockData;
  readonly fivem: FiveMData;
}

export type GameId = keyof GameDataMap;

export interface QueryInput<G extends GameId = GameId> {
  readonly game: G;
  readonly host: string;
  readonly port?: number;
  readonly queryPort?: number;
  readonly mode?: QueryMode;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface QueryResultBase<G extends GameId> {
  readonly game: G;
  readonly durationMs: number;
  readonly sources: readonly QuerySource[];
  readonly warnings: readonly QueryWarning[];
}

export interface QuerySuccess<G extends GameId> extends QueryResultBase<G> {
  readonly ok: true;
  readonly server: ServerInfo;
  readonly data: GameDataMap[G];
  readonly partial: boolean;
}

export interface QueryFailure<G extends GameId> extends QueryResultBase<G> {
  readonly ok: false;
  readonly error: QueryError;
}

export type QueryResult<G extends GameId = GameId> = G extends GameId
  ? QuerySuccess<G> | QueryFailure<G>
  : never;
