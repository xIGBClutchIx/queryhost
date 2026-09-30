/** Bounded Arma 3 server-browser metadata decoding over the shared A2S Rules exchange. */

import { A2sBinaryReader } from "../a2s/binary.js";
import type { A2sChallengePacket } from "../a2s/challenge.js";
import { failA2s } from "../a2s/errors.js";
import type { A2sExchangeDependencies } from "../a2s/network.js";
import type { A2sRules, A2sRulesQueryOptions, A2sRulesQueryResult } from "../a2s/rules.js";
import {
  parseBohemiaRulesPacket,
  queryBohemiaRules,
  readBohemiaString,
  readBohemiaUnsigned,
  type BohemiaPagedRulesFormat,
} from "../bohemia/rules.js";

const ARMA3_RULES_PROTOCOL = 3;
// Arma 3 splits large mod lists across up to 255 pages of about 124 bytes each.
const MAX_PAGE_COUNT = 255;
const MAX_MODS = 255;
const MAX_SIGNATURES = 255;
const CREATOR_DLC_ID_LENGTH = 19;
const WORKSHOP_ID_LENGTHS: ReadonlySet<number> = new Set([1, 4, 8]);

/** Difficulty settings packed into the two bytes after Arma 3's DLC mask. */
export interface Arma3RuleDifficulty {
  readonly level: number;
  readonly aiLevel: number;
  readonly advancedFlightModel: boolean;
  readonly thirdPerson: boolean;
  readonly crosshair: boolean;
}

/** One official DLC flagged in the metadata's 16-bit mask, with its advertised hash. */
export interface Arma3RuleDlc {
  readonly flag: number;
  readonly hash: number;
}

/** One loaded mod; Creator DLC entries carry only their Steam App ID. */
export type Arma3RuleMod =
  | {
      readonly kind: "mod";
      readonly name: string;
      readonly workshopId?: string;
      readonly hash: number;
    }
  | { readonly kind: "creator-dlc"; readonly appId: number; readonly hash: number };

/** Arma 3-owned structured fields carried inside otherwise ordinary A2S Rules records. */
export interface Arma3RuleMetadata {
  readonly protocol: number;
  readonly difficulty?: Arma3RuleDifficulty;
  readonly dlc: readonly Arma3RuleDlc[];
  readonly mods: readonly Arma3RuleMod[];
  readonly signatures: readonly string[];
  readonly description?: string;
}

const METADATA = new WeakMap<A2sRules, Arma3RuleMetadata>();

function difficulty(value: number, crosshair: number): Arma3RuleDifficulty | undefined {
  // A zero byte means the server did not advertise difficulty at all.
  if (value === 0) {
    return undefined;
  }
  return Object.freeze({
    level: value & 0b111,
    aiLevel: (value >> 3) & 0b111,
    // Bohemia sets bit 6 when the advanced flight model is disabled.
    advancedFlightModel: (value & 0x40) === 0,
    thirdPerson: (value & 0x80) !== 0,
    crosshair: (crosshair & 0x01) !== 0,
  });
}

function readMod(reader: A2sBinaryReader): Arma3RuleMod {
  const hash = reader.readUint32();
  const idLength = reader.readUint8();
  if (idLength === CREATOR_DLC_ID_LENGTH) {
    return Object.freeze({ kind: "creator-dlc", appId: reader.readUint32(), hash });
  }
  if (!WORKSHOP_ID_LENGTHS.has(idLength)) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const workshopId = readBohemiaUnsigned(reader, idLength);
  const name = readBohemiaString(reader);
  return Object.freeze({
    kind: "mod",
    name,
    // Zero identifies a local mod rather than a Workshop item.
    ...(workshopId === 0n ? {} : { workshopId: workshopId.toString() }),
    hash,
  });
}

function parseMetadata(bytes: Uint8Array): Arma3RuleMetadata {
  const reader = new A2sBinaryReader(bytes);
  const protocol = reader.readUint8();
  if (protocol !== ARMA3_RULES_PROTOCOL) {
    return failA2s("MALFORMED_RESPONSE");
  }

  // The flags byte is undocumented and carries no known public meaning.
  reader.readUint8();
  const dlcMask = reader.readUint16();
  const advertised = difficulty(reader.readUint8(), reader.readUint8());
  const dlc: Arma3RuleDlc[] = [];
  for (let flag = 1; flag <= 0x8000; flag <<= 1) {
    if ((dlcMask & flag) !== 0) {
      dlc.push(Object.freeze({ flag, hash: reader.readUint32() }));
    }
  }

  const modCount = reader.readUint8();
  if (modCount > MAX_MODS) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const mods: Arma3RuleMod[] = [];
  for (let index = 0; index < modCount; index += 1) {
    mods.push(readMod(reader));
  }

  const signatureCount = reader.readUint8();
  if (signatureCount > MAX_SIGNATURES) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const signatures: string[] = [];
  for (let index = 0; index < signatureCount; index += 1) {
    signatures.push(readBohemiaString(reader));
  }

  const description = reader.remaining === 0 ? undefined : readBohemiaString(reader);
  reader.expectEnd();
  return Object.freeze({
    protocol,
    ...(advertised === undefined ? {} : { difficulty: advertised }),
    dlc: Object.freeze(dlc),
    mods: Object.freeze(mods),
    signatures: Object.freeze(signatures),
    ...(description === undefined ? {} : { description }),
  });
}

const FORMAT: BohemiaPagedRulesFormat<Arma3RuleMetadata> = {
  maxPages: MAX_PAGE_COUNT,
  decode: parseMetadata,
};

/** Parses one Arma 3 Rules response, including its bounded binary metadata pages. */
export function parseArma3RulesPacket(packet: Uint8Array): A2sChallengePacket<A2sRules> {
  return parseBohemiaRulesPacket(packet, FORMAT, METADATA);
}

/** Retrieves structured metadata associated with a parsed Arma 3 rule map. */
export function arma3RuleMetadata(rules: A2sRules): Arma3RuleMetadata | undefined {
  return METADATA.get(rules);
}

/** Performs Arma 3 Rules with the shared bounded, one-retry challenge flow. */
export async function queryArma3Rules(
  options: A2sRulesQueryOptions,
  dependencies?: A2sExchangeDependencies,
): Promise<A2sRulesQueryResult> {
  return queryBohemiaRules(options, parseArma3RulesPacket, dependencies);
}
