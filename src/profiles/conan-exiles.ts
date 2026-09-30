/** Conan Exiles interpretation over the shared Unreal Engine Steam profile. */

import type { ConanExilesData } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sProfileOptions } from "./a2s.js";
import type { SteamA2sProfileResult } from "./steam-a2s.js";
import { queryUnrealSteamProfile, unrealText } from "./unreal.js";
import { optionalField } from "./values.js";

/** Queries Conan Exiles without its unanswered Player source and adds its full server name. */
export async function queryConanExilesProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<ConanExilesData>> {
  return queryUnrealSteamProfile<ConanExilesData>(
    // Conan Exiles never answers A2S Player, so querying it would only add a timeout.
    { ...options, playerPolicy: "unsupported" },
    GAME_REGISTRY["conan-exiles"].name,
    // Its many other Rules keys are obfuscated (`S0_b`, `Sx_i`, ...) with no public meaning.
    (values) => optionalField("fullServerName", unrealText(values.get("OWNINGNAME"))),
  );
}
