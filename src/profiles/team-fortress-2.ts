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

/**
 * Steam stores game tags in a 128-byte buffer that includes its terminator, so a keyword string of
 * 127 bytes or more may have lost later tags, and its last tag may be cut short.
 */
const STEAM_TAG_LIMIT_BYTES = 127;

function isTruncated(keywords: string): boolean {
  return new TextEncoder().encode(keywords).byteLength >= STEAM_TAG_LIMIT_BYTES;
}

function tagData(
  tags: readonly string[] | undefined,
  keywords: string | undefined,
): Partial<TeamFortress2Data> {
  if (tags === undefined) {
    return {};
  }
  if (keywords !== undefined && isTruncated(keywords)) {
    // An absent tag may only have been cut off, so only tags that survived whole confirm a
    // non-default value. The final tag may itself be partial and is ignored.
    const whole = tags.slice(0, -1);
    return {
      ...(whole.includes("friendlyfire") ? { friendlyFire: true } : {}),
      ...(whole.includes("nocrits") ? { randomCrits: false } : {}),
      ...(whole.includes("highlander") ? { highlander: true } : {}),
      ...(whole.includes("medieval") ? { medieval: true } : {}),
    };
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
    ({ server, data, keywords }) => ({
      server,
      data: { ...data, ...tagData(data.tags, keywords) },
    }),
  );
}
