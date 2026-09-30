/** ARK: Survival Evolved interpretation of its Unreal Engine Rules over the shared Steam A2S profile. */

import type { ArkSurvivalEvolvedData, ArkSurvivalEvolvedMod } from "../contracts/games.js";
import type { ServerInfo } from "../contracts/shared.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { unrealSessionData, unrealSessionValues } from "./unreal.js";
import { booleanValue, optionalField, textValue } from "./values.js";

// ARK can advertise hundreds of mods; this bounds how many `MODn_s` keys are read.
const MAX_MODS = 1_024;
// ARK's Info version is a placeholder; the build is the ` - (v358.7)` suffix of the server name.
const NAME_VERSION = / - \(v(\d+(?:\.\d+)*)\)$/u;
const MOD = /^([1-9]\d*):([0-9A-Fa-f]{32})$/u;

function flag(value: string | undefined): boolean | undefined {
  return booleanValue(value, ["1", "true", "True"], ["0", "false", "False"]);
}

function mods(rules: A2sRules): readonly ArkSurvivalEvolvedMod[] | undefined {
  const active = flag(rules["HASACTIVEMODS_i"]);
  if (active === false) {
    return Object.freeze([]);
  }
  const result: ArkSurvivalEvolvedMod[] = [];
  for (let index = 0; index < MAX_MODS; index += 1) {
    const value = rules[`MOD${String(index)}_s`];
    if (value === undefined) {
      break;
    }
    const match = MOD.exec(value);
    if (match?.[1] === undefined || match[2] === undefined) {
      return undefined;
    }
    result.push(Object.freeze({ workshopId: match[1], hash: match[2] }));
  }
  // Only `HASACTIVEMODS_i` of 0 confirms zero mods; a missing list is not a confirmation.
  return result.length === 0 ? undefined : Object.freeze(result);
}

function rulesData(rules: A2sRules | undefined): Partial<ArkSurvivalEvolvedData> {
  if (rules === undefined) {
    return {};
  }
  return {
    ...optionalField("customServerName", textValue(rules["CUSTOMSERVERNAME_s"])),
    ...optionalField("pve", flag(rules["SESSIONISPVE_i"])),
    ...optionalField("battlEye", flag(rules["SERVERUSESBATTLEYE_b"])),
    ...optionalField("official", flag(rules["OFFICIALSERVER_i"] ?? rules["OFFICIALSERVER_s"])),
    ...optionalField("clusterId", textValue(rules["ClusterId_s"])),
    ...optionalField("gameMode", textValue(rules["GameMode_s"])),
    ...optionalField("dayTime", textValue(rules["DayTime_s"])),
    ...optionalField("allowDownloadCharacters", flag(rules["ALLOWDOWNLOADCHARS_i"])),
    ...optionalField("allowDownloadItems", flag(rules["ALLOWDOWNLOADITEMS_i"])),
    ...optionalField("mods", mods(rules)),
  };
}

function server(info: ServerInfo): ServerInfo {
  const version = info.name === undefined ? undefined : NAME_VERSION.exec(info.name)?.[1];
  return version === undefined ? info : { ...info, version };
}

/** Queries ARK, types its session Rules, and reads the build from the server name suffix. */
export async function queryArkSurvivalEvolvedProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<ArkSurvivalEvolvedData>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["ark-survival-evolved"].name },
    (facts) => ({
      server: server(facts.server),
      data: {
        ...facts.data,
        ...unrealSessionData(unrealSessionValues(facts.keywords, facts.rules)),
        ...rulesData(facts.rules),
      },
    }),
  );
}
