/** Bounded DayZ server-browser metadata decoding over the shared A2S Rules exchange. */

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

const DAYZ_RULES_PROTOCOL = 2;
const MAX_PAGE_COUNT = 32;
const MAX_MODS = 255;
const MAX_SIGNATURES = 255;

/** One mod decoded from DayZ's paged Rules metadata. */
export interface DayZRuleMod {
  readonly name: string;
  readonly workshopId?: string;
  readonly hash: number;
}

/** DayZ-owned structured fields carried inside otherwise ordinary A2S Rules records. */
export interface DayZRuleMetadata {
  readonly protocol: number;
  readonly description?: string;
  readonly mods: readonly DayZRuleMod[];
  readonly signatures: readonly string[];
}

const METADATA = new WeakMap<A2sRules, DayZRuleMetadata>();

function parseMetadata(bytes: Uint8Array): DayZRuleMetadata {
  const reader = new A2sBinaryReader(bytes);
  const protocol = reader.readUint8();
  if (protocol !== DAYZ_RULES_PROTOCOL) {
    return failA2s("MALFORMED_RESPONSE");
  }

  // DayZ protocol v2 retains an undocumented flags byte and 16-bit DLC mask before mods.
  reader.readUint8();
  reader.readUint16();
  const modCount = reader.readUint8();
  if (modCount > MAX_MODS) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const mods: DayZRuleMod[] = [];
  for (let index = 0; index < modCount; index += 1) {
    const hash = reader.readUint32();
    const workshopId = readBohemiaUnsigned(reader, reader.readUint8());
    const name = readBohemiaString(reader);
    mods.push(
      Object.freeze({
        name,
        ...(workshopId === 0n ? {} : { workshopId: workshopId.toString() }),
        hash,
      }),
    );
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
    ...(description === undefined ? {} : { description }),
    mods: Object.freeze(mods),
    signatures: Object.freeze(signatures),
  });
}

const FORMAT: BohemiaPagedRulesFormat<DayZRuleMetadata> = {
  maxPages: MAX_PAGE_COUNT,
  decode: parseMetadata,
};

/** Parses one DayZ Rules response, including its bounded binary metadata pages. */
export function parseDayZRulesPacket(packet: Uint8Array): A2sChallengePacket<A2sRules> {
  return parseBohemiaRulesPacket(packet, FORMAT, METADATA);
}

/** Retrieves structured metadata associated with a parsed DayZ rule map. */
export function dayZRuleMetadata(rules: A2sRules): DayZRuleMetadata | undefined {
  return METADATA.get(rules);
}

/** Performs DayZ Rules with the shared bounded, one-retry challenge flow. */
export async function queryDayZRules(
  options: A2sRulesQueryOptions,
  dependencies?: A2sExchangeDependencies,
): Promise<A2sRulesQueryResult> {
  return queryBohemiaRules(options, parseDayZRulesPacket, dependencies);
}
