/** Bounded reassembly of Bohemia Interactive's paged server-browser metadata in A2S Rules. */

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
const MAX_RULES = 4_096;
const MAX_RULE_NAME_BYTES = 1_024;
const MAX_RULE_VALUE_BYTES = 8_192;
const MAX_METADATA_BYTES = 65_536;

/** Format-specific decoding applied to the unescaped metadata pages. */
export interface BohemiaPagedRulesFormat<T> {
  /**
   * Highest page count accepted. Page keys are two raw bytes, so a two-character direct rule
   * name could only be mistaken for a page when both bytes are at or below this bound.
   */
  readonly maxPages: number;
  readonly decode: (bytes: Uint8Array) => T;
}

/** Reads an unsigned little-endian integer whose width the metadata declares. */
export function readBohemiaUnsigned(reader: A2sBinaryReader, length: number): bigint {
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

/** Reads a one-byte-length-prefixed UTF-8 string. */
export function readBohemiaString(reader: A2sBinaryReader): string {
  return decodeA2sUtf8(reader.readBytes(reader.readUint8()));
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

/**
 * Parses one Rules response, keeping direct string rules and decoding any paged metadata into
 * `metadata`, keyed by the returned rule map.
 */
export function parseBohemiaRulesPacket<T>(
  packet: Uint8Array,
  format: BohemiaPagedRulesFormat<T>,
  metadata: WeakMap<A2sRules, T>,
): A2sChallengePacket<A2sRules> {
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
    const page = nameBytes[0];
    const total = nameBytes[1];
    if (
      nameBytes.length === 2 &&
      page !== undefined &&
      total !== undefined &&
      page >= 1 &&
      page <= format.maxPages &&
      total >= 1 &&
      total <= format.maxPages
    ) {
      if (page > total || (pageCount !== undefined && pageCount !== total) || pages.has(page)) {
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

  const rules: A2sRules = Object.freeze(direct);
  if (pageCount !== undefined) {
    const ordered: Uint8Array[] = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const value = pages.get(page);
      if (value === undefined) {
        return failA2s("MALFORMED_RESPONSE");
      }
      ordered.push(value);
    }
    metadata.set(rules, format.decode(unescapePages(ordered)));
  }
  return { kind: "data", value: rules };
}

/** Performs Rules with the shared bounded, one-retry challenge flow and a paged-metadata parser. */
export async function queryBohemiaRules(
  options: A2sRulesQueryOptions,
  parse: (packet: Uint8Array) => A2sChallengePacket<A2sRules>,
  dependencies?: A2sExchangeDependencies,
): Promise<A2sRulesQueryResult> {
  const result = await queryA2sChallengeSource(options, A2S_RULES_REQUEST, parse, dependencies);
  return { rules: result.value, rttMs: result.rttMs, challenged: result.challenged };
}
