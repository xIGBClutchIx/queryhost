/** Generic public interpretation over reusable Source and GoldSource A2S sources. */

import type { A2sData, A2sPlayer as PublicA2sPlayer, GameRuleMap } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sInfo } from "../protocols/a2s/info.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

export type GenericA2sProfileOptions = A2sProfileOptions;

export interface GenericA2sProfileResult {
  readonly server: ServerInfo;
  readonly data: A2sData;
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

function players(values: readonly A2sPlayer[]): readonly PublicA2sPlayer[] {
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

function genericData(info: A2sInfo, optionalPlayers: readonly A2sPlayer[] | undefined): A2sData {
  return Object.freeze({
    protocol: info.protocol,
    game: info.game,
    folder: info.folder,
    bots: info.bots,
    serverType: info.serverType,
    environment: info.environment,
    vac: info.vac,
    ...(info.format === "source" ? { appId: info.appId } : {}),
    ...(info.format === "source" && info.keywords !== undefined
      ? { tags: tags(info.keywords) }
      : {}),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

/** Queries generic A2S Info and optional Player and Rules without game-specific interpretation. */
export async function queryGenericA2sProfile(
  options: GenericA2sProfileOptions,
): Promise<GenericA2sProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings("A2S", result.optional.sources);
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: genericData(result.info.info, result.optional.players),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
