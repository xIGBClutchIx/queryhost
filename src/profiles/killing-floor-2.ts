/** Killing Floor 2 interpretation of its Unreal Engine 3 match Rules over the shared Steam A2S profile. */

import type { KillingFloor2Data } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { booleanValue, optionalField, textValue, unsignedValue } from "./values.js";

const DIFFICULTIES: readonly NonNullable<KillingFloor2Data["difficulty"]>[] = [
  "normal",
  "hard",
  "suicidal",
  "hell-on-earth",
];

// Unreal Engine 3 online settings write booleans as `True` and `False`.
function flag(value: string | undefined): boolean | undefined {
  return booleanValue(value, ["True"], ["False"]);
}

function rulesData(rules: A2sRules | undefined): Partial<KillingFloor2Data> {
  if (rules === undefined) {
    return {};
  }
  const difficulty = unsignedValue(rules["Difficulty"], DIFFICULTIES.length - 1);
  // `MapName`, `ZedCount`, and `MaxZedCount` stay raw: captures show them frozen at defaults.
  return {
    ...optionalField("gameMode", textValue(rules["Mode"])),
    ...optionalField("difficulty", difficulty === undefined ? undefined : DIFFICULTIES[difficulty]),
    ...optionalField("currentWave", unsignedValue(rules["CurrentWave"], 255)),
    ...optionalField("totalWaves", unsignedValue(rules["NumWaves"], 255)),
    ...optionalField("inProgress", flag(rules["bInProgress"])),
    ...optionalField("mutators", flag(rules["bMutators"])),
    ...optionalField("custom", flag(rules["bCustom"])),
    ...optionalField("spectators", unsignedValue(rules["NumSpectators"], 255)),
  };
}

/** Queries Killing Floor 2 and types its wave, difficulty, and match-state Rules. */
export async function queryKillingFloor2Profile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<KillingFloor2Data>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["killing-floor-2"].name },
    ({ server, data, rules }) => ({ server, data: { ...data, ...rulesData(rules) } }),
  );
}
