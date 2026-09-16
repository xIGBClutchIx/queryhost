/** Valheim interpretation over the reusable A2S profile sources. */

import type { ValheimData, ValheimPlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs available after the public query layer pins a Valheim Steam-backend destination. */
export type ValheimProfileOptions = A2sProfileOptions;

/** Fully merged Valheim profile result before the public query envelope is added. */
export interface ValheimProfileResult {
  readonly server: ServerInfo;
  readonly data: ValheimData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function players(values: readonly A2sPlayer[]): readonly ValheimPlayer[] {
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

/** Queries the direct Steam A2S endpoint; PlayFab crossplay has no equivalent direct endpoint. */
export async function queryValheimProfile(
  options: ValheimProfileOptions,
): Promise<ValheimProfileResult> {
  const result = await queryA2sProfile({ ...options, rulesPolicy: "unsupported" });
  const info = result.info.info;
  const optionalWarnings = a2sProfileWarnings("Valheim", result.optional.sources);
  const networkVersion = info.format === "source" ? info.keywords : undefined;
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: Object.freeze({
      backend: "steam",
      ...(networkVersion === undefined ? {} : { networkVersion }),
      ...(result.optional.players === undefined
        ? {}
        : { players: players(result.optional.players) }),
    }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
