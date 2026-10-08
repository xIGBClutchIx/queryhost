/**
 * Browser-safe `queryhost/registry` entry point. It carries only game metadata and alias
 * helpers, so bundlers can include it without the Node.js transports behind `query()`.
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
  GAME_IDS,
  GAME_REGISTRY,
  getGameDefinition,
  isGameAlias,
  isGameId,
  isGameInputId,
  listGames,
} from "./contracts/registry.js";
