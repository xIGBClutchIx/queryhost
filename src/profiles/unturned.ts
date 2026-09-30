/** Unturned interpretation of its server-browser keywords and Rules over the shared Steam A2S profile. */

import type { UnturnedData, UnturnedLink } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { decimalValue, listValue, optionalField, textValue, unsignedValue } from "./values.js";

// Unturned splits long values into 127-character rules; this bounds the chunks read per value.
const MAX_CHUNKS = 256;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

const DIFFICULTIES: ReadonlyMap<string, UnturnedData["difficulty"]> = new Map([
  ["EZY", "easy"],
  ["NRM", "normal"],
  ["HRD", "hard"],
]);
const CAMERA_MODES: ReadonlyMap<string, UnturnedData["cameraMode"]> = new Map([
  ["1Pp", "first-person"],
  ["2Pp", "both"],
  ["3Pp", "third-person"],
  ["4Pp", "vehicle"],
]);
const MONETIZATION: ReadonlyMap<string, UnturnedData["monetization"]> = new Map([
  ["MTXn", "none"],
  ["MTXy", "non-gameplay"],
  ["MTXg", "monetized"],
]);
const PLUGIN_FRAMEWORKS: ReadonlyMap<string, UnturnedData["pluginFramework"]> = new Map([
  ["rm", "rocketmod"],
  ["om", "openmod"],
]);

function first<T>(tokens: readonly string[], values: ReadonlyMap<string, T>): T | undefined {
  for (const token of tokens) {
    const value = values.get(token);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function pair(tokens: readonly string[], yes: string, no: string): boolean | undefined {
  if (tokens.includes(yes)) {
    return true;
  }
  return tokens.includes(no) ? false : undefined;
}

function enclosed(keywords: string, tag: string): string | undefined {
  const start = keywords.indexOf(`<${tag}>`);
  if (start < 0) {
    return undefined;
  }
  const valueStart = start + tag.length + 2;
  const end = keywords.indexOf(`</${tag}>`, valueStart);
  return end < 0 ? undefined : textValue(keywords.slice(valueStart, end));
}

function keywordData(keywords: string | undefined): Partial<UnturnedData> {
  // The game writes its PvP flag first; anything else is not Unturned's structured format.
  const tokens = (keywords ?? "").split(",").map((token) => token.trim());
  if (tokens[0] !== "PVP" && tokens[0] !== "PVE") {
    return {};
  }
  // Only tokens before the free-form thumbnail URL are flags, matching the game's own parser.
  const thumbnail = tokens.findIndex((token) => token.startsWith("<"));
  const flags = thumbnail < 0 ? tokens : tokens.slice(0, thumbnail);
  const text = keywords ?? "";
  return {
    pvp: flags[0] === "PVP",
    ...optionalField("cheats", pair(flags, "CHy", "CHn")),
    ...optionalField("difficulty", first(flags, DIFFICULTIES)),
    ...optionalField("cameraMode", first(flags, CAMERA_MODES)),
    ...optionalField("workshop", pair(flags, "WSy", "WSn")),
    ...optionalField("goldOnly", pair(flags, "GLD", "F2P")),
    anycastProxy: flags.includes("ACP"),
    ...optionalField("battlEye", pair(flags, "BEy", "BEn")),
    ...optionalField("monetization", first(flags, MONETIZATION)),
    ...optionalField("thumbnailUrl", enclosed(text, "tn")),
    ...optionalField("networkTransport", enclosed(text, "net")),
    ...optionalField("pluginFramework", PLUGIN_FRAMEWORKS.get(enclosed(text, "pf") ?? "")),
  };
}

function chunked(rules: A2sRules, countKey: string, prefix: string): string | undefined {
  const count = unsignedValue(rules[countKey], MAX_CHUNKS);
  if (count === undefined || count === 0) {
    return undefined;
  }
  let joined = "";
  for (let index = 0; index < count; index += 1) {
    const chunk = rules[`${prefix}${String(index)}`];
    if (chunk === undefined) {
      return undefined;
    }
    joined += chunk;
  }
  return joined;
}

function base64Text(value: string | undefined): string | undefined {
  if (value === undefined || !BASE64.test(value)) {
    return undefined;
  }
  try {
    return UTF8.decode(Uint8Array.from(Buffer.from(value, "base64")));
  } catch {
    return undefined;
  }
}

function workshopIds(rules: A2sRules): readonly string[] | undefined {
  const joined = chunked(rules, "Mod_Count", "Mod_");
  if (joined === undefined) {
    return undefined;
  }
  const ids = listValue(joined);
  return ids.every((id) => /^[1-9]\d*$/u.test(id)) ? ids : undefined;
}

function links(rules: A2sRules): readonly UnturnedLink[] | undefined {
  const count = unsignedValue(rules["Custom_Links_Count"], MAX_CHUNKS);
  if (count === undefined) {
    return undefined;
  }
  const result: UnturnedLink[] = [];
  for (let index = 0; index < count; index += 1) {
    const message = base64Text(rules[`Custom_Link_Message_${String(index)}`]);
    const url = base64Text(rules[`Custom_Link_Url_${String(index)}`]);
    // The server skips a link it cannot encode, so a missing index is not an error.
    if (message !== undefined && url !== undefined) {
      result.push(Object.freeze({ message, url }));
    }
  }
  return Object.freeze(result);
}

function config(rules: A2sRules): Readonly<Record<string, boolean | number>> | undefined {
  const count = unsignedValue(rules["Cfg_Count"], MAX_CHUNKS);
  if (count === undefined) {
    return undefined;
  }
  const values: Record<string, boolean | number> = {};
  for (let index = 0; index < count; index += 1) {
    const entry = rules[`Cfg_${String(index)}`] ?? "";
    const separator = entry.indexOf("=");
    const key = entry.slice(0, separator);
    const raw = entry.slice(separator + 1);
    const value = raw === "T" ? true : raw === "F" ? false : decimalValue(raw);
    if (separator > 0 && /^\w+\.\w+$/u.test(key) && value !== undefined) {
      Object.defineProperty(values, key, { value, enumerable: true });
    }
  }
  return Object.freeze(values);
}

function rulesData(rules: A2sRules | undefined): Partial<UnturnedData> {
  if (rules === undefined) {
    return {};
  }
  const plugins = rules["rocketplugins"];
  return {
    ...optionalField("gameVersion", textValue(rules["GameVersion"])),
    ...optionalField("modName", textValue(rules["ModName"])),
    ...optionalField("modVersion", textValue(rules["ModVersion"])),
    ...optionalField("iconUrl", textValue(rules["Browser_Icon"])),
    ...optionalField("descriptionHint", textValue(rules["Browser_Desc_Hint"])),
    ...optionalField("bookmarkHost", textValue(rules["BookmarkHost"])),
    ...optionalField(
      "description",
      base64Text(chunked(rules, "Browser_Desc_Full_Count", "Browser_Desc_Full_Line_")),
    ),
    ...optionalField("workshopIds", workshopIds(rules)),
    ...optionalField("links", links(rules)),
    ...optionalField("config", config(rules)),
    ...optionalField("plugins", plugins === undefined ? undefined : listValue(plugins)),
  };
}

/** Queries Unturned and types its server-browser keyword flags and chunked Rules. */
export async function queryUnturnedProfile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<UnturnedData>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY.unturned.name },
    ({ server, data, keywords, rules }) => ({
      server,
      data: { ...data, ...keywordData(keywords), ...rulesData(rules) },
    }),
  );
}
