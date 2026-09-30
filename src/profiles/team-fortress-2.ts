/** Team Fortress 2 interpretation of its automatic server-browser tags over the shared Steam A2S profile. */

import type { TeamFortress2Data, TeamFortress2GameMode } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";

// Mode tags come from `convars_to_check_for_tags` in the Source SDK 2013 `tf_gamerules.cpp`.
const GAME_MODES: ReadonlySet<string> = new Set<TeamFortress2GameMode>([
  "arena",
  "cp",
  "ctf",
  "sd",
  "mvm",
  "payload",
  "rd",
  "pd",
  "tc",
  "passtime",
  "misc",
]);

function isGameMode(tag: string): tag is TeamFortress2GameMode {
  return GAME_MODES.has(tag);
}

function tagData(tags: readonly string[] | undefined): Partial<TeamFortress2Data> {
  if (tags === undefined) {
    return {};
  }
  return {
    gameModes: Object.freeze([...new Set(tags.filter(isGameMode))]),
    friendlyFire: tags.includes("friendlyfire"),
    randomCrits: !tags.includes("nocrits"),
    highlander: tags.includes("highlander"),
    medieval: tags.includes("medieval"),
  };
}

/** Queries Team Fortress 2 and derives its game modes and notable settings from its tags. */
export async function queryTeamFortress2Profile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<TeamFortress2Data>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["team-fortress-2"].name },
    ({ server, data }) => ({ server, data: { ...data, ...tagData(data.tags) } }),
  );
}
