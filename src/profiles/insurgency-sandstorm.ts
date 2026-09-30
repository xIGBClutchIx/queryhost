/** Insurgency: Sandstorm interpretation of its Unreal Engine Rules over the shared Steam A2S profile. */

import type { InsurgencySandstormData } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { booleanValue, listValue, optionalField, textValue } from "./values.js";

function flag(value: string | undefined): boolean | undefined {
  return booleanValue(value, ["true"], ["false"]);
}

/** A `false` switch confirms an empty list; `true` needs its companion list rule. */
function switchedList(
  enabled: boolean | undefined,
  value: string | undefined,
): readonly string[] | undefined {
  if (enabled === false) {
    return Object.freeze([]);
  }
  return enabled === true && value !== undefined ? listValue(value) : undefined;
}

function rulesData(rules: A2sRules | undefined): Partial<InsurgencySandstormData> {
  if (rules === undefined) {
    return {};
  }
  const day = flag(rules["Day_b"]);
  const lighting: InsurgencySandstormData["lighting"] =
    day === undefined ? undefined : day ? "day" : "night";
  const modIds = switchedList(flag(rules["Mods_b"]), rules["ModList_s"]);
  return {
    ...optionalField("gameMode", textValue(rules["GameMode_s"])),
    ...optionalField("coop", flag(rules["Coop_b"])),
    ...optionalField("lighting", lighting),
    ...optionalField("ranked", flag(rules["RankedServer_b"])),
    ...optionalField("mutators", switchedList(flag(rules["Mutated_b"]), rules["Mutators_s"])),
    ...optionalField(
      "modIds",
      modIds?.every((id) => /^\d+$/u.test(id)) === false ? undefined : modIds,
    ),
  };
}

/** Queries Insurgency: Sandstorm and types its mode, lighting, ranking, mutator, and mod Rules. */
export async function queryInsurgencySandstormProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<InsurgencySandstormData>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["insurgency-sandstorm"].name },
    ({ server, data, rules }) => ({ server, data: { ...data, ...rulesData(rules) } }),
  );
}
