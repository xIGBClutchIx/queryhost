/** Strict A2S Player parser and bounded challenge query flow. */

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
const A2S_PLAYER_REQUEST = 0x55;
const S2A_PLAYER = 0x44;
const MAX_PLAYER_NAME_BYTES = 1_024;

/** One player reported by an A2S Player response. */
export interface A2sPlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  /** Seconds connected, as reported by the server. */
  readonly durationSeconds: number;
}

/** Parsed A2S Player response before challenge orchestration. */
export type A2sPlayerPacket = A2sChallengePacket<readonly A2sPlayer[]>;

/** Dependencies used by the direct A2S Player query. */
export type A2sPlayerDependencies = A2sExchangeDependencies;

/** Inputs for a direct A2S Player query against one selected pinned address. */
export type A2sPlayerQueryOptions = A2sQueryOptions;

/** Parsed player list and complete request/challenge round-trip duration. */
export interface A2sPlayerQueryResult {
  readonly players: readonly A2sPlayer[];
  readonly rttMs: number;
  readonly challenged: boolean;
}

/** Encodes an A2S Player request with the initial or server-provided challenge. */
export function encodeA2sPlayerRequest(challenge = -1): Uint8Array {
  return encodeA2sChallengeRequest(A2S_PLAYER_REQUEST, challenge);
}

/** Parses one reconstructed A2S Player response or challenge packet. */
export function parseA2sPlayerPacket(packet: Uint8Array): A2sPlayerPacket {
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
  if (responseType !== S2A_PLAYER) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const count = reader.readUint8();
  const indexes = new Set<number>();
  const players: A2sPlayer[] = [];
  for (let position = 0; position < count; position += 1) {
    const index = reader.readUint8();
    if (indexes.has(index)) {
      return failA2s("MALFORMED_RESPONSE");
    }
    indexes.add(index);
    const name = reader.readString(MAX_PLAYER_NAME_BYTES);
    const score = reader.readInt32();
    const durationSeconds = reader.readFloat32();
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      return failA2s("MALFORMED_RESPONSE");
    }
    players.push(Object.freeze({ index, name, score, durationSeconds }));
  }
  reader.expectEnd();
  return { kind: "data", value: Object.freeze(players) };
}

/** Performs A2S Player with at most one server-requested challenge retry. */
export async function queryA2sPlayer(
  options: A2sPlayerQueryOptions,
  dependencies?: A2sPlayerDependencies,
): Promise<A2sPlayerQueryResult> {
  const result = await queryA2sChallengeSource(
    options,
    A2S_PLAYER_REQUEST,
    parseA2sPlayerPacket,
    dependencies,
  );
  return {
    players: result.value,
    rttMs: result.rttMs,
    challenged: result.challenged,
  };
}
