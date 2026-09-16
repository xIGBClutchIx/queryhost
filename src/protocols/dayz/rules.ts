/** Bounded DayZ server-browser metadata decoding over the shared A2S Rules exchange. */

import { A2sBinaryReader, decodeA2sUtf8 } from "../a2s/binary.js";
import { queryA2sChallengeSource, type A2sChallengePacket } from "../a2s/challenge.js";
import { failA2s } from "../a2s/errors.js";
import type { A2sExchangeDependencies } from "../a2s/network.js";
import type { A2sRules, A2sRulesQueryOptions, A2sRulesQueryResult } from "../a2s/rules.js";
import { A2S_MAX_RESPONSE_BYTES } from "../a2s/split.js";

const SINGLE_PACKET_HEADER = -1;
const S2C_CHALLENGE = 0x41;
const A2S_RULES_REQUEST = 0x56;
const S2A_RULES = 0x45;
const DAYZ_RULES_PROTOCOL = 2;
const MAX_RULES = 4_096;
const MAX_RULE_NAME_BYTES = 1_024;
const MAX_RULE_VALUE_BYTES = 8_192;
const MAX_PAGE_COUNT = 32;
const MAX_METADATA_BYTES = 65_536;
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

function bytesToUnsigned(reader: A2sBinaryReader, length: number): bigint {
  if (length < 1 || length > 8) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const bytes = reader.readBytes(length);
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      return failA2s("MALFORMED_RESPONSE");
    }
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function readLengthString(reader: A2sBinaryReader): string {
  return decodeA2sUtf8(reader.readBytes(reader.readUint8()));
}

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
    const workshopId = bytesToUnsigned(reader, reader.readUint8());
    const name = readLengthString(reader);
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
    signatures.push(readLengthString(reader));
  }

  const description = reader.remaining === 0 ? undefined : readLengthString(reader);
  reader.expectEnd();
  return Object.freeze({
    protocol,
    ...(description === undefined ? {} : { description }),
    mods: Object.freeze(mods),
    signatures: Object.freeze(signatures),
  });
}

function unescapePages(pages: readonly Uint8Array[]): Uint8Array {
  const output: number[] = [];
  let escaping = false;
  for (const page of pages) {
    for (const byte of page) {
      if (byte === undefined) {
        return failA2s("MALFORMED_RESPONSE");
      }
      if (!escaping && byte === 0x01) {
        escaping = true;
        continue;
      }
      if (!escaping) {
        output.push(byte);
      } else if (byte === 0x01) {
        output.push(0x01);
        escaping = false;
      } else if (byte === 0x02) {
        output.push(0x00);
        escaping = false;
      } else if (byte === 0x03) {
        output.push(0xff);
        escaping = false;
      } else {
        return failA2s("MALFORMED_RESPONSE");
      }
      if (output.length > MAX_METADATA_BYTES) {
        return failA2s("RESPONSE_TOO_LARGE");
      }
    }
  }
  if (escaping) {
    return failA2s("MALFORMED_RESPONSE");
  }
  return Uint8Array.from(output);
}

function frozenRules(values: Readonly<Record<string, string>>): A2sRules {
  return Object.freeze(values);
}

/** Parses one DayZ Rules response, including its bounded binary metadata pages. */
export function parseDayZRulesPacket(packet: Uint8Array): A2sChallengePacket<A2sRules> {
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
  const direct: Record<string, string> = {};
  const pages = new Map<number, Uint8Array>();
  let pageCount: number | undefined;
  for (let position = 0; position < count; position += 1) {
    const nameBytes = reader.readStringBytes(MAX_RULE_NAME_BYTES);
    const valueBytes = reader.readStringBytes(MAX_RULE_VALUE_BYTES);
    if (
      nameBytes.length === 2 &&
      nameBytes[0] !== undefined &&
      nameBytes[1] !== undefined &&
      nameBytes[0] >= 1 &&
      nameBytes[0] <= MAX_PAGE_COUNT &&
      nameBytes[1] >= 1 &&
      nameBytes[1] <= MAX_PAGE_COUNT
    ) {
      const page = nameBytes[0];
      const total = nameBytes[1];
      if (page < 1 || total < 1 || total > MAX_PAGE_COUNT || page > total) {
        return failA2s("MALFORMED_RESPONSE");
      }
      if ((pageCount !== undefined && pageCount !== total) || pages.has(page)) {
        return failA2s("MALFORMED_RESPONSE");
      }
      pageCount = total;
      pages.set(page, valueBytes);
      continue;
    }

    const name = decodeA2sUtf8(nameBytes);
    const value = decodeA2sUtf8(valueBytes);
    if (name.length === 0 || Object.hasOwn(direct, name)) {
      return failA2s("MALFORMED_RESPONSE");
    }
    Object.defineProperty(direct, name, { value, enumerable: true });
  }
  reader.expectEnd();

  const rules = frozenRules(direct);
  if (pageCount !== undefined) {
    const ordered: Uint8Array[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const value = pages.get(page);
      if (value === undefined) {
        return failA2s("MALFORMED_RESPONSE");
      }
      ordered.push(value);
    }
    METADATA.set(rules, parseMetadata(unescapePages(ordered)));
  }
  return { kind: "data", value: rules };
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
  const result = await queryA2sChallengeSource(
    options,
    A2S_RULES_REQUEST,
    parseDayZRulesPacket,
    dependencies,
  );
  return { rules: result.value, rttMs: result.rttMs, challenged: result.challenged };
}
