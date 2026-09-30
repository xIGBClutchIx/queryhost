/** Soulmask interpretation over the shared Steam A2S profile. */

import { GAME_REGISTRY } from "../contracts/registry.js";
import {
  querySteamA2sProfile,
  type SteamA2sProfileOptions,
  type SteamA2sProfileResult,
} from "./steam-a2s.js";

/** Soulmask advertises a hardcoded A2S Info version; its game build is the `NO_s` rule. */
const VERSION_RULE = "NO_s";

/** Queries Soulmask and prefers its Rules-advertised build over the placeholder Info version. */
export async function querySoulmaskProfile(
  options: Omit<SteamA2sProfileOptions, "gameName">,
): Promise<SteamA2sProfileResult> {
  const result = await querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY.soulmask.name });
  const version = result.rawData?.rules[VERSION_RULE];
  if (version === undefined || version.length === 0) {
    return result;
  }
  return Object.freeze({ ...result, server: Object.freeze({ ...result.server, version }) });
}
