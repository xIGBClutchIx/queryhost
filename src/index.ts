export type { GameCapability, GameDefinition, GameRegistry, SupportLevel } from "./registry.js";
export { GAME_IDS, GAME_REGISTRY, getGameDefinition, isGameId, listGames } from "./registry.js";
export type {
  GameId,
  GameDataMap,
  QueryFailure,
  QueryInput,
  QueryResult,
  QuerySuccess,
} from "./query.js";
export type {
  QueryError,
  QueryErrorCode,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  QueryWarningCode,
  ServerInfo,
  ServerPlayers,
} from "./shared.js";
export type {
  FiveMData,
  FiveMPlayer,
  GameRuleMap,
  MinecraftBedrockData,
  MinecraftJavaData,
  MinecraftMotd,
  MinecraftPlugin,
  MinecraftSoftware,
  MinecraftSrvTarget,
  ProjectZomboidData,
  RustData,
  SevenDaysToDieData,
} from "./games.js";

/** The public package name. */
export const QUERYHOST_NAME = "queryhost" as const;
