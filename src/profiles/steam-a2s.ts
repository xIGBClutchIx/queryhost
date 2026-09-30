/** Shared Steam A2S interpretation, with a hook for game-specific keyword and Rules decoding. */

import type { GameRuleMap, SteamA2sData, SteamA2sPlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sInfo, A2sSourceInfo } from "../protocols/a2s/info.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs for one Steam A2S game; the caller-facing name only labels warnings. */
export interface SteamA2sProfileOptions extends A2sProfileOptions {
  readonly gameName: string;
}

/** Fully merged Steam A2S profile result before the public query envelope is added. */
export interface SteamA2sProfileResult<D extends SteamA2sData = SteamA2sData> {
  readonly server: ServerInfo;
  readonly data: D;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

/** Protocol facts a game-specific interpretation may read before the result is frozen. */
export interface SteamA2sFacts {
  readonly server: ServerInfo;
  readonly data: SteamA2sData;
  /** Unsplit A2S Info keywords, for games that encode structure across commas. */
  readonly keywords?: string;
  /** Rules map as returned by the profile's Rules decoder, when Rules succeeded. */
  readonly rules?: A2sRules;
}

/** Game-specific data and optional server-summary corrections derived from {@link SteamA2sFacts}. */
export interface SteamA2sInterpretation<D extends SteamA2sData> {
  readonly data: D;
  readonly server?: ServerInfo;
}

function tags(keywords: string): readonly string[] {
  return Object.freeze(
    keywords
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  );
}

/** Steam game IDs keep the App ID in their low 24 bits. */
const GAME_ID_APP_MASK = 0xff_ffffn;

function appId(info: A2sSourceInfo): number {
  return info.gameId === undefined ? info.appId : Number(info.gameId & GAME_ID_APP_MASK);
}

function players(values: readonly A2sPlayer[]): readonly SteamA2sPlayer[] {
  return Object.freeze(
    values.map((player) =>
      Object.freeze({
        index: player.index,
        name: player.name,
        score: player.score,
        durationSeconds: player.durationSeconds,
      }),
    ),
  );
}

function steamA2sData(
  info: A2sInfo,
  optionalPlayers: readonly A2sPlayer[] | undefined,
): SteamA2sData {
  return Object.freeze({
    game: info.game,
    folder: info.folder,
    bots: info.bots,
    serverType: info.serverType,
    environment: info.environment,
    vac: info.vac,
    ...(info.format === "source" ? { appId: appId(info) } : {}),
    ...(info.format === "source" && info.port !== undefined ? { gamePort: info.port } : {}),
    ...(info.format === "source" && info.steamId !== undefined
      ? { serverSteamId: info.steamId.toString() }
      : {}),
    ...(info.format === "source" && info.keywords !== undefined
      ? { tags: tags(info.keywords) }
      : {}),
    // Advertised SourceTV relays are reported only; the profile never connects to them.
    ...(info.format === "source" && info.sourceTv !== undefined
      ? { sourceTv: Object.freeze({ port: info.sourceTv.port, name: info.sourceTv.name }) }
      : {}),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

/** Queries required Info and the profile's optional Player and Rules, then applies `interpret`. */
export async function querySteamA2sGame<D extends SteamA2sData>(
  options: SteamA2sProfileOptions,
  interpret: (facts: SteamA2sFacts) => SteamA2sInterpretation<D>,
): Promise<SteamA2sProfileResult<D>> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings(options.gameName, result.optional.sources);
  const info = result.info.info;
  const interpretation = interpret({
    server: a2sServerInfo(result.info),
    data: steamA2sData(info, result.optional.players),
    ...(info.format === "source" && info.keywords !== undefined ? { keywords: info.keywords } : {}),
    ...(result.optional.rules === undefined ? {} : { rules: result.optional.rules }),
  });
  return Object.freeze({
    server: Object.freeze(interpretation.server ?? a2sServerInfo(result.info)),
    data: Object.freeze(interpretation.data),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}

/** Queries required Info and the profile's optional Player and Rules for one Steam game server. */
export async function querySteamA2sProfile(
  options: SteamA2sProfileOptions,
): Promise<SteamA2sProfileResult> {
  return querySteamA2sGame(options, ({ server, data }) => ({ server, data }));
}
