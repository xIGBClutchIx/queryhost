/** Soulmask interpretation over the shared Steam A2S profile. */

import type { SoulmaskData } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { unrealSessionData, unrealSessionValues } from "./unreal.js";

/** Soulmask advertises a hardcoded A2S Info version; its game build is the `NO_s` rule. */
const VERSION_RULE = "NO_s";

/** Queries Soulmask and prefers its Rules-advertised build over the placeholder Info version. */
export async function querySoulmaskProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<SoulmaskData>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY.soulmask.name },
    ({ server, data, keywords, rules }) => {
      const version = rules?.[VERSION_RULE];
      return {
        data: { ...data, ...unrealSessionData(unrealSessionValues(keywords, rules)) },
        server: version === undefined || version.length === 0 ? server : { ...server, version },
      };
    },
  );
}
