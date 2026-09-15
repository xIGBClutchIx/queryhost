/** Don't Starve Together interpretation over its per-shard Steam A2S endpoint. */

import type {
  DontStarveTogetherData,
  DontStarveTogetherPlayer,
  GameRuleMap,
} from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sInfo } from "../protocols/a2s/info.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs available after the public query layer pins a DST Steam query destination. */
export type DontStarveTogetherProfileOptions = A2sProfileOptions;

/** Fully merged DST shard result before the public query envelope is added. */
export interface DontStarveTogetherProfileResult {
  readonly server: ServerInfo;
  readonly data: DontStarveTogetherData;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function tags(keywords: string): readonly string[] {
  return Object.freeze(
    keywords
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  );
}

function players(values: readonly A2sPlayer[]): readonly DontStarveTogetherPlayer[] {
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

function dstData(
  info: A2sInfo,
  optionalPlayers: readonly A2sPlayer[] | undefined,
): DontStarveTogetherData {
  return Object.freeze({
    protocol: info.protocol,
    game: info.game,
    folder: info.folder,
    bots: info.bots,
    serverType: info.serverType,
    environment: info.environment,
    vac: info.vac,
    ...(info.format === "source" ? { appId: info.appId } : {}),
    ...(info.format === "source" && info.gameId !== undefined
      ? { steamGameId: info.gameId.toString() }
      : {}),
    ...(info.format === "source" && info.keywords !== undefined
      ? { tags: tags(info.keywords) }
      : {}),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

/** Queries one DST shard through required Info and optional Player and Rules sources. */
export async function queryDontStarveTogetherProfile(
  options: DontStarveTogetherProfileOptions,
): Promise<DontStarveTogetherProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings("Don't Starve Together", result.optional.sources);
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: dstData(result.info.info, result.optional.players),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
