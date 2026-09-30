/** Shared interpretation for Valve Source-engine games over their game-port A2S endpoint. */

import type { GameRuleMap, SourceEngineData, SourceEnginePlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sInfo } from "../protocols/a2s/info.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs for one Source-engine game; the caller-facing name only labels warnings. */
export interface SourceEngineProfileOptions extends A2sProfileOptions {
  readonly gameName: string;
}

/** Fully merged Source-engine profile result before the public query envelope is added. */
export interface SourceEngineProfileResult {
  readonly server: ServerInfo;
  readonly data: SourceEngineData;
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

function players(values: readonly A2sPlayer[]): readonly SourceEnginePlayer[] {
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

function sourceEngineData(
  info: A2sInfo,
  optionalPlayers: readonly A2sPlayer[] | undefined,
): SourceEngineData {
  return Object.freeze({
    folder: info.folder,
    bots: info.bots,
    serverType: info.serverType,
    environment: info.environment,
    vac: info.vac,
    ...(info.format === "source" ? { appId: info.appId } : {}),
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

/** Queries required Info and optional Player and Rules for one Source-engine game server. */
export async function querySourceEngineProfile(
  options: SourceEngineProfileOptions,
): Promise<SourceEngineProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings(options.gameName, result.optional.sources);
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: sourceEngineData(result.info.info, result.optional.players),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
