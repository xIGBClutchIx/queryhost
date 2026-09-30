/** Arma 3 interpretation over the shared Steam A2S profile and its paged Rules metadata. */

import type { Arma3CreatorDlc, Arma3Data, Arma3Dlc, Arma3Mod } from "../contracts/games.js";
import { GAME_REGISTRY } from "../contracts/registry.js";
import { arma3RuleMetadata, queryArma3Rules } from "../protocols/arma3/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sProfile, type SteamA2sProfileResult } from "./steam-a2s.js";

/** Fully merged Arma 3 result before the public query envelope is added. */
export interface Arma3ProfileResult extends Omit<SteamA2sProfileResult, "data"> {
  readonly data: Arma3Data;
}

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

function rulesData(result: SteamA2sProfileResult): Partial<Arma3Data> {
  const metadata =
    result.rawData === undefined ? undefined : arma3RuleMetadata(result.rawData.rules);
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
export async function queryArma3Profile(options: A2sProfileOptions): Promise<Arma3ProfileResult> {
  const result = await querySteamA2sProfile({
    ...options,
    gameName: GAME_REGISTRY["arma-3"].name,
    queryRules: queryArma3Rules,
  });
  return Object.freeze({
    ...result,
    data: Object.freeze({ ...result.data, ...rulesData(result) }),
  });
}
