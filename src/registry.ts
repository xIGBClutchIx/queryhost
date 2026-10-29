/**
 * Browser-safe `queryhost/registry` entry point. It carries only game metadata, alias helpers, and
 * the result vocabulary, so bundlers can include it without the Node.js transports behind
 * `query()`.
 */

export type {
  CanonicalGameId,
  GameAlias,
  GameAliasMap,
  GameId,
  GameInputId,
  GameProtocolMap,
} from "./contracts/query.js";
export type {
  GameCapability,
  GameDefinition,
  GameProtocol,
  GameRegistry,
  SupportLevel,
} from "./contracts/registry.js";
export {
  canonicalGameId,
  GAME_ALIASES,
  GAME_CAPABILITIES,
  GAME_IDS,
  GAME_PROTOCOLS,
  GAME_REGISTRY,
  getGameDefinition,
  isGameAlias,
  isGameId,
  isGameInputId,
  listGames,
  SUPPORT_LEVELS,
} from "./contracts/registry.js";
export type { DetectErrorCode } from "./contracts/detect.js";
export { DETECT_ERROR_CODES, DETECT_ERROR_GUIDANCE } from "./contracts/detect.js";
export type {
  CodeGuidance,
  QueryErrorCode,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarningCode,
} from "./contracts/shared.js";
export {
  QUERY_ERROR_CODES,
  QUERY_ERROR_GUIDANCE,
  QUERY_SOURCE_LABELS,
  QUERY_SOURCE_NAMES,
  QUERY_SOURCE_STATUSES,
  QUERY_WARNING_CODES,
  QUERY_WARNING_GUIDANCE,
} from "./contracts/shared.js";
