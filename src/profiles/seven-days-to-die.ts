/** 7 Days to Die-specific interpretation over reusable A2S profile sources. */

import type { GameRuleMap, SevenDaysToDieData, SevenDaysToDiePlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs available after the public query layer pins a 7 Days to Die destination. */
export type SevenDaysToDieProfileOptions = A2sProfileOptions;

/** Fully merged 7 Days to Die result before the public query envelope is added. */
export interface SevenDaysToDieProfileResult {
  readonly server: ServerInfo;
  readonly data: SevenDaysToDieData;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function players(values: readonly A2sPlayer[]): readonly SevenDaysToDiePlayer[] {
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

function sevenDaysToDieData(
  optionalPlayers: readonly A2sPlayer[] | undefined,
  rules: A2sRules | undefined,
): SevenDaysToDieData {
  const description = rules?.["ServerDescription"];
  const gameName = rules?.["GameName"];
  const gameWorld = rules?.["LevelName"];
  const gameMode = rules?.["GameMode"];
  const currentServerTime = rules?.["CurrentServerTime"];
  const websiteUrl = rules?.["ServerWebsiteURL"];
  return Object.freeze({
    ...(description === undefined ? {} : { description }),
    ...(gameName === undefined ? {} : { gameName }),
    ...(gameWorld === undefined ? {} : { gameWorld }),
    ...(gameMode === undefined ? {} : { gameMode }),
    ...(currentServerTime === undefined ? {} : { currentServerTime }),
    ...(websiteUrl === undefined ? {} : { websiteUrl }),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

/** Queries shared A2S sources and applies only 7 Days to Die-owned rule interpretation. */
export async function querySevenDaysToDieProfile(
  options: SevenDaysToDieProfileOptions,
): Promise<SevenDaysToDieProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings("7 Days to Die", result.optional.sources);
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: sevenDaysToDieData(result.optional.players, result.optional.rules),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
