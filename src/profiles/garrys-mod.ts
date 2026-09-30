/** Garry's Mod interpretation of its `key:value` keywords over the shared Steam A2S profile. */

import type { GarrysModData } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { optionalField, textValue } from "./values.js";

function tokens(keywords: string): readonly string[] {
  return Object.freeze(keywords.split(/[\s,]+/u).filter((token) => token.length > 0));
}

// The engine writes `gm`, `gmws`, `gmc`, `loc`, and `ver` as space-separated `key:value` pairs.
function keywordData(keywords: string | undefined): Partial<GarrysModData> {
  if (keywords === undefined) {
    return {};
  }
  const values = new Map<string, string>();
  const tags = tokens(keywords);
  for (const tag of tags) {
    const separator = tag.indexOf(":");
    const key = tag.slice(0, separator);
    if (separator > 0 && !values.has(key)) {
      values.set(key, tag.slice(separator + 1));
    }
  }
  const workshopId = values.get("gmws");
  const build = values.get("ver");
  return {
    tags,
    ...optionalField("gamemode", textValue(values.get("gm"))),
    ...optionalField(
      "gamemodeWorkshopId",
      workshopId !== undefined && /^[1-9]\d*$/u.test(workshopId) ? workshopId : undefined,
    ),
    ...optionalField("gamemodeCategory", textValue(values.get("gmc"))),
    ...optionalField("location", textValue(values.get("loc"))),
    ...optionalField("build", build !== undefined && /^\d{6}$/u.test(build) ? build : undefined),
  };
}

/** Queries Garry's Mod and types the gamemode, category, location, and build keywords. */
export async function queryGarrysModProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<GarrysModData>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["garrys-mod"].name },
    ({ server, data, keywords }) => ({ server, data: { ...data, ...keywordData(keywords) } }),
  );
}
