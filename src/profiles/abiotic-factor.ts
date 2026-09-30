/** Abiotic Factor interpretation over the shared Unreal Engine Steam profile. */

import type { AbioticFactorData } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sProfileOptions } from "./a2s.js";
import type { SteamA2sProfileResult } from "./steam-a2s.js";
import { queryUnrealSteamProfile, unrealBoolean, unrealText } from "./unreal.js";
import { optionalField } from "./values.js";

/** Queries Abiotic Factor and adds its join code and password lock. */
export async function queryAbioticFactorProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<AbioticFactorData>> {
  return queryUnrealSteamProfile<AbioticFactorData>(
    options,
    GAME_REGISTRY["abiotic-factor"].name,
    (values) => ({
      ...optionalField("joinCode", unrealText(values.get("ShortCode_s"))),
      ...optionalField("locked", unrealBoolean(values.get("Locked_b"))),
    }),
  );
}
