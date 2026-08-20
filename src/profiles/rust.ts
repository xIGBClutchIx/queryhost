/** Rust-specific interpretation over reusable A2S profile sources. */

import type { RustData, RustPlayer } from "../games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../shared.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileObserver,
  type A2sProfileOptions,
} from "./a2s.js";

/** Internal source lifecycle observer for whole-query provenance. */
export type RustProfileObserver = A2sProfileObserver;

/** Inputs available after the public query layer resolves and pins a Rust destination. */
export type RustProfileOptions = A2sProfileOptions;

/** Fully merged Rust profile result before the public query envelope is added. */
export interface RustProfileResult {
  readonly server: ServerInfo;
  readonly data: RustData;
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

function rustPlayers(players: readonly A2sPlayer[]): readonly RustPlayer[] {
  return Object.freeze(
    players.map((player) =>
      Object.freeze({
        index: player.index,
        name: player.name,
        score: player.score,
        durationSeconds: player.durationSeconds,
      }),
    ),
  );
}

/** Queries shared A2S sources and applies only Rust-owned interpretation. */
export async function queryRustProfile(options: RustProfileOptions): Promise<RustProfileResult> {
  const result = await queryA2sProfile(options);
  const protocolInfo = result.info.info;
  const optionalWarnings = a2sProfileWarnings("Rust", result.optional.sources);
  const data: RustData = Object.freeze({
    ...(protocolInfo.format === "source" && protocolInfo.keywords !== undefined
      ? { tags: tags(protocolInfo.keywords) }
      : {}),
    ...(result.optional.players === undefined
      ? {}
      : { players: rustPlayers(result.optional.players) }),
    ...(result.optional.rules === undefined ? {} : { rules: result.optional.rules }),
  });
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data,
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
