/** Public QueryHost package surface. Internal transports and safety primitives are not re-exported. */

export type { GameCapability, GameDefinition, GameRegistry, SupportLevel } from "./registry.js";
export {
  canonicalGameId,
  GAME_ALIASES,
  GAME_IDS,
  GAME_REGISTRY,
  getGameDefinition,
  isGameAlias,
  isGameId,
  isGameInputId,
  listGames,
} from "./registry.js";
export type {
  CanonicalGameId,
  GameAlias,
  GameAliasMap,
  GameId,
  GameDataMap,
  GameInputId,
  GameRawDataMap,
  QueryFailure,
  QueryInput,
  QueryResult,
  QuerySuccess,
} from "./query.js";
export { query } from "./client.js";
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
  A2sRawData,
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
  ProjectZomboidPlayer,
  RustData,
  RustPlayer,
  SevenDaysToDieData,
  SevenDaysToDiePlayer,
} from "./games.js";
