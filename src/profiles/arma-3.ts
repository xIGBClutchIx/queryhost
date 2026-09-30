/** Arma 3 interpretation over the shared Steam A2S profile and its paged Rules metadata. */

import type { Arma3CreatorDlc, Arma3Data, Arma3Dlc, Arma3Mod } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import { arma3RuleMetadata, queryArma3Rules } from "../protocols/arma3/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";

interface KnownDlc {
  readonly name: string;
  readonly appId: number;
}

// Mask bits and App IDs follow Bohemia's server-browser protocol and the Steam store.
const OFFICIAL_DLC: ReadonlyMap<number, KnownDlc> = new Map([
  [0x1, { name: "Karts", appId: 288_520 }],
  [0x2, { name: "Marksmen", appId: 332_350 }],
  [0x4, { name: "Helicopters", appId: 304_380 }],
  [0x8, { name: "Zeus", appId: 275_700 }],
  [0x10, { name: "Apex", appId: 395_180 }],
  [0x20, { name: "Jets", appId: 601_670 }],
  [0x40, { name: "Laws of War", appId: 571_710 }],
  [0x80, { name: "Malden", appId: 639_600 }],
  [0x100, { name: "Tac-Ops Mission Pack", appId: 744_950 }],
  [0x200, { name: "Tanks", appId: 798_390 }],
  [0x400, { name: "Contact", appId: 1_021_790 }],
  [0x800, { name: "Contact (Platform)", appId: 1_021_790 }],
  [0x1000, { name: "Art of War", appId: 1_325_500 }],
]);

const CREATOR_DLC: ReadonlyMap<number, string> = new Map([
  [1_042_220, "Global Mobilization - Cold War Germany"],
  [1_175_380, "Spearhead 1944"],
  [1_227_700, "S.O.G. Prairie Fire"],
  [1_294_440, "CSLA Iron Curtain"],
  [1_681_170, "Western Sahara"],
  [2_647_760, "Reaction Forces"],
  [2_647_830, "Expeditionary Forces"],
]);

const PLATFORMS: ReadonlyMap<string, "linux" | "macos" | "windows"> = new Map([
  ["l", "linux"],
  ["m", "macos"],
  ["w", "windows"],
]);

function flag(value: string): boolean | undefined {
  if (value === "t" || value === "1") {
    return true;
  }
  if (value === "f" || value === "0") {
    return false;
  }
  return undefined;
}

function unsigned(value: string, maximum: number): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed <= maximum ? parsed : undefined;
}

function text(value: string): string | undefined {
  return value.length === 0 ? undefined : value;
}

// Bohemia's server-browser keywords use the first character as the key and the rest as its value.
function keywordValues(tags: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const tag of tags) {
    const key = tag.slice(0, 1);
    // The first occurrence wins so a repeated key cannot silently replace it.
    if (tag.length > 1 && !values.has(key)) {
      values.set(key, tag.slice(1));
    }
  }
  return values;
}

function optional<K extends keyof Arma3Data>(
  key: K,
  value: Arma3Data[K] | undefined,
): Partial<Pick<Arma3Data, K>> {
  return value === undefined ? {} : ({ [key]: value } as Pick<Arma3Data, K>);
}

function keywordData(tags: readonly string[] | undefined): Partial<Arma3Data> {
  const values = keywordValues(tags ?? []);
  const read = (key: string): string => values.get(key) ?? "";
  const uint32 = (key: string): number | undefined => unsigned(read(key), 4_294_967_295);
  return {
    ...optional("battlEye", flag(read("b"))),
    ...optional("requiredVersion", uint32("r")),
    ...optional("requiredBuild", uint32("n")),
    ...optional("serverState", unsigned(read("s"), 9)),
    ...optional("gameType", text(read("t"))),
    ...optional("equalModsRequired", flag(read("m"))),
    ...optional("locked", flag(read("l"))),
    ...optional("verifySignatures", flag(read("v"))),
    ...optional("dedicated", flag(read("d"))),
    ...optional("filePatching", flag(read("f"))),
    ...optional("platform", PLATFORMS.get(read("p"))),
    ...optional("language", uint32("g")),
    ...optional("country", text(read("o"))),
    ...optional("timeLeftMinutes", uint32("e")),
    ...optional("island", text(read("y"))),
    ...optional("loadedContentHash", text(read("h"))),
  };
}

function rulesData(rules: A2sRules | undefined): Partial<Arma3Data> {
  const metadata = rules === undefined ? undefined : arma3RuleMetadata(rules);
  if (metadata === undefined) {
    return {};
  }
  const dlc: Arma3Dlc[] = metadata.dlc.map(({ flag, hash }) => {
    const known = OFFICIAL_DLC.get(flag);
    return Object.freeze(known === undefined ? { flag, hash } : { flag, ...known, hash });
  });
  const creatorDlc: Arma3CreatorDlc[] = [];
  const mods: Arma3Mod[] = [];
  for (const entry of metadata.mods) {
    if (entry.kind === "creator-dlc") {
      const name = CREATOR_DLC.get(entry.appId);
      creatorDlc.push(
        Object.freeze({
          appId: entry.appId,
          ...(name === undefined ? {} : { name }),
          hash: entry.hash,
        }),
      );
    } else {
      mods.push(
        Object.freeze({
          name: entry.name,
          ...(entry.workshopId === undefined ? {} : { workshopId: entry.workshopId }),
          hash: entry.hash,
        }),
      );
    }
  }
  return {
    rulesProtocol: metadata.protocol,
    ...(metadata.difficulty === undefined ? {} : { difficulty: metadata.difficulty }),
    dlc: Object.freeze(dlc),
    creatorDlc: Object.freeze(creatorDlc),
    mods: Object.freeze(mods),
    signatures: metadata.signatures,
    ...(metadata.description === undefined ? {} : { description: metadata.description }),
  };
}

/** Queries Arma 3 and decodes its paged Rules metadata into mods, DLC, and difficulty. */
export async function queryArma3Profile(
  options: A2sProfileOptions,
): Promise<SteamA2sProfileResult<Arma3Data>> {
  return querySteamA2sGame(
    { ...options, gameName: GAME_REGISTRY["arma-3"].name, queryRules: queryArma3Rules },
    ({ server, data, rules }) => ({
      server,
      data: { ...data, ...keywordData(data.tags), ...rulesData(rules) },
    }),
  );
}
