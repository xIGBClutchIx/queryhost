/** Strict A2S Rules parser and bounded challenge query flow. */

import { A2sBinaryReader } from "./binary.js";
import {
  encodeA2sChallengeRequest,
  queryA2sChallengeSource,
  type A2sChallengePacket,
} from "./challenge.js";
import { failA2s } from "./errors.js";
import type { A2sExchangeDependencies, A2sQueryOptions } from "./network.js";
import { A2S_MAX_RESPONSE_BYTES } from "./split.js";

const SINGLE_PACKET_HEADER = -1;
const S2C_CHALLENGE = 0x41;
const A2S_RULES_REQUEST = 0x56;
const S2A_RULES = 0x45;
const MAX_RULES = 4_096;
const MAX_RULE_NAME_BYTES = 1_024;
const MAX_RULE_VALUE_BYTES = 8_192;

/** String-valued rules reported by one A2S Rules response. */
export type A2sRules = Readonly<Record<string, string>>;

/** Parsed A2S Rules response before challenge orchestration. */
export type A2sRulesPacket = A2sChallengePacket<A2sRules>;

/** Dependencies used by the direct A2S Rules query. */
export type A2sRulesDependencies = A2sExchangeDependencies;

/** Inputs for a direct A2S Rules query against one selected pinned address. */
export type A2sRulesQueryOptions = A2sQueryOptions;

/** Parsed rules and complete request/challenge round-trip duration. */
export interface A2sRulesQueryResult {
  readonly rules: A2sRules;
  readonly rttMs: number;
  readonly challenged: boolean;
}

/** Encodes an A2S Rules request with the initial or server-provided challenge. */
export function encodeA2sRulesRequest(challenge = -1): Uint8Array {
  return encodeA2sChallengeRequest(A2S_RULES_REQUEST, challenge);
}

/** Parses one reconstructed A2S Rules response or challenge packet. */
export function parseA2sRulesPacket(packet: Uint8Array): A2sRulesPacket {
  if (packet.byteLength < 5 || packet.byteLength > A2S_MAX_RESPONSE_BYTES) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const reader = new A2sBinaryReader(packet);
  if (reader.readInt32() !== SINGLE_PACKET_HEADER) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const responseType = reader.readUint8();
  if (responseType === S2C_CHALLENGE) {
    const challenge = reader.readInt32();
    reader.expectEnd();
    return { kind: "challenge", challenge };
  }
  if (responseType !== S2A_RULES) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const count = reader.readUint16();
  if (count > MAX_RULES) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const rules: Record<string, string> = {};
  for (let position = 0; position < count; position += 1) {
    const name = reader.readString(MAX_RULE_NAME_BYTES);
    const value = reader.readString(MAX_RULE_VALUE_BYTES);
    if (name.length === 0 || Object.hasOwn(rules, name)) {
      return failA2s("MALFORMED_RESPONSE");
    }
    // Defining a data property prevents special names such as "__proto__" from mutating the map.
    Object.defineProperty(rules, name, { value, enumerable: true });
  }
  reader.expectEnd();
  return { kind: "data", value: Object.freeze(rules) };
}

/** Performs A2S Rules with at most one server-requested challenge retry. */
export async function queryA2sRules(
  options: A2sRulesQueryOptions,
  dependencies?: A2sRulesDependencies,
): Promise<A2sRulesQueryResult> {
  const result = await queryA2sChallengeSource(
    options,
    A2S_RULES_REQUEST,
    parseA2sRulesPacket,
    dependencies,
  );
  return { rules: result.value, rttMs: result.rttMs, challenged: result.challenged };
}
