/** Palworld interpretation over its public Steam A2S query listener. */

import type { GameRuleMap, PalworldData, PalworldPlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sInfo } from "../protocols/a2s/info.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

export type PalworldProfileOptions = A2sProfileOptions;

export interface PalworldProfileResult {
  readonly server: ServerInfo;
  readonly data: PalworldData;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function tags(info: A2sInfo): readonly string[] | undefined {
  if (info.format !== "source" || info.keywords === undefined) {
    return undefined;
  }
  return Object.freeze(
    info.keywords
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  );
}

function players(values: readonly A2sPlayer[]): readonly PalworldPlayer[] {
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

function palworldData(
  info: A2sInfo,
  optionalPlayers: readonly A2sPlayer[] | undefined,
): PalworldData {
  const advertisedTags = tags(info);
  return Object.freeze({
    ...(advertisedTags === undefined ? {} : { tags: advertisedTags }),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

/** Queries Palworld A2S Info and conditionally available Player and Rules sources. */
export async function queryPalworldProfile(
  options: PalworldProfileOptions,
): Promise<PalworldProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings("Palworld", result.optional.sources);
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: palworldData(result.info.info, result.optional.players),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
