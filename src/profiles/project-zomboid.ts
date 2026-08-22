/** Project Zomboid-specific interpretation over reusable A2S profile sources. */

import type { GameRuleMap, ProjectZomboidData, ProjectZomboidPlayer } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sPlayer } from "../protocols/a2s/player.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs available after the public query layer pins a Project Zomboid destination. */
export type ProjectZomboidProfileOptions = A2sProfileOptions;

/** Fully merged Project Zomboid result before the public query envelope is added. */
export interface ProjectZomboidProfileResult {
  readonly server: ServerInfo;
  readonly data: ProjectZomboidData;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function players(values: readonly A2sPlayer[]): readonly ProjectZomboidPlayer[] {
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

function booleanRule(value: string | undefined): boolean | undefined {
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return undefined;
}

function modIds(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(";")
      .map((mod) => mod.trim())
      .filter((mod) => mod.length > 0),
  );
}

function projectZomboidData(
  optionalPlayers: readonly A2sPlayer[] | undefined,
  rules: A2sRules | undefined,
): ProjectZomboidData {
  const description = rules?.["description"];
  const pvp = booleanRule(rules?.["pvp"]);
  const mods = rules?.["mods"];
  return Object.freeze({
    ...(description === undefined ? {} : { description }),
    ...(pvp === undefined ? {} : { pvp }),
    ...(mods === undefined ? {} : { mods: modIds(mods) }),
    ...(optionalPlayers === undefined ? {} : { players: players(optionalPlayers) }),
  });
}

function projectZomboidServer(result: Awaited<ReturnType<typeof queryA2sProfile>>): ServerInfo {
  const info = a2sServerInfo(result.info);
  const version = result.optional.rules?.["version"];
  return version === undefined ? info : Object.freeze({ ...info, version });
}

/** Queries shared A2S sources and applies only Project Zomboid-owned rule interpretation. */
export async function queryProjectZomboidProfile(
  options: ProjectZomboidProfileOptions,
): Promise<ProjectZomboidProfileResult> {
  const result = await queryA2sProfile(options);
  const optionalWarnings = a2sProfileWarnings("Project Zomboid", result.optional.sources);
  return Object.freeze({
    server: projectZomboidServer(result),
    data: projectZomboidData(result.optional.players, result.optional.rules),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
