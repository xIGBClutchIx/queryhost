/** Satisfactory Dedicated Server Lightweight Query packet encoding and parsing. */

import type { SatisfactoryServerState, SatisfactorySubState } from "../../contracts/games.js";
import { failSatisfactory } from "./errors.js";

const MAGIC = 0xf6d5;
const POLL_SERVER_STATE = 0;
const SERVER_STATE_RESPONSE = 1;
const PROTOCOL_VERSION = 1;
const TERMINATOR = 1;
const REQUEST_BYTES = 13;
const MIN_RESPONSE_BYTES = 29;
const MAX_RESPONSE_BYTES = 2_048;
const MAX_SERVER_NAME_BYTES = 1_024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Parsed response from the authentication-free lightweight status service. */
export interface SatisfactoryLightweightState {
  readonly cookie: bigint;
  readonly state: SatisfactoryServerState;
  readonly stateCode: 1 | 2 | 3;
  readonly serverNetCl: number;
  /** Decimal representation preserves the unsigned 64-bit flag field for JSON callers. */
  readonly serverFlags: string;
  readonly modded: boolean;
  readonly subStates: readonly SatisfactorySubState[];
  readonly serverName: string;
}

function state(code: number): SatisfactoryServerState {
  if (code === 1) return "idle";
  if (code === 2) return "loading";
  if (code === 3) return "playing";
  return failSatisfactory("MALFORMED_RESPONSE");
}

/** Encodes the exact version-1 poll envelope with a caller-owned correlation cookie. */
export function encodeSatisfactoryPoll(cookie: bigint): Uint8Array {
  if (cookie < 0n || cookie > 0xffff_ffff_ffff_ffffn) {
    return failSatisfactory("INVALID_INPUT");
  }
  const packet = new Uint8Array(REQUEST_BYTES);
  const view = new DataView(packet.buffer);
  view.setUint16(0, MAGIC, true);
  packet[2] = POLL_SERVER_STATE;
  packet[3] = PROTOCOL_VERSION;
  view.setBigUint64(4, cookie, true);
  packet[12] = TERMINATOR;
  return packet;
}

/** Parses one exact version-1 response and verifies its request cookie. */
export function parseSatisfactoryState(
  packet: Uint8Array,
  expectedCookie: bigint,
): SatisfactoryLightweightState {
  if (packet.byteLength > MAX_RESPONSE_BYTES) {
    return failSatisfactory("RESPONSE_TOO_LARGE");
  }
  if (packet.byteLength < MIN_RESPONSE_BYTES) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (
    view.getUint16(0, true) !== MAGIC ||
    packet[2] !== SERVER_STATE_RESPONSE ||
    packet[3] !== PROTOCOL_VERSION ||
    packet.at(-1) !== TERMINATOR ||
    view.getBigUint64(4, true) !== expectedCookie
  ) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const stateCode = packet[12];
  if (stateCode !== 1 && stateCode !== 2 && stateCode !== 3) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const serverNetCl = view.getUint32(13, true);
  const flags = view.getBigUint64(17, true);
  const subStateCount = packet[25];
  if (subStateCount === undefined) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const nameLengthOffset = 26 + subStateCount * 3;
  if (nameLengthOffset + 3 > packet.byteLength) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const subStates: SatisfactorySubState[] = [];
  for (let index = 0; index < subStateCount; index += 1) {
    const offset = 26 + index * 3;
    const id = packet[offset];
    if (id === undefined) {
      return failSatisfactory("MALFORMED_RESPONSE");
    }
    // IDs 0-7 are currently defined. Future unknown IDs are ignored per the protocol contract.
    if (id <= 7) {
      subStates.push(Object.freeze({ id, version: view.getUint16(offset + 1, true) }));
    }
  }
  const nameLength = view.getUint16(nameLengthOffset, true);
  if (
    nameLength > MAX_SERVER_NAME_BYTES ||
    nameLengthOffset + 2 + nameLength + 1 !== packet.byteLength
  ) {
    return failSatisfactory(
      nameLength > MAX_SERVER_NAME_BYTES ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE",
    );
  }
  let serverName: string;
  try {
    serverName = UTF8.decode(packet.subarray(nameLengthOffset + 2, packet.byteLength - 1));
  } catch {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  return Object.freeze({
    cookie: expectedCookie,
    state: state(stateCode),
    stateCode,
    serverNetCl,
    serverFlags: flags.toString(),
    modded: (flags & 1n) !== 0n,
    subStates: Object.freeze(subStates),
    serverName,
  });
}
