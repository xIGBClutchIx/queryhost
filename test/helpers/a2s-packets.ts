/** Builds synthetic single-packet A2S answers so game tests can vary one field at a time. */

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { UdpTransportError, type UdpCollectionResult } from "../../src/transports/udp.js";
import { packetType } from "./a2s-profile.js";

/** Source-format Info fields; optional ones set the matching extra-data flag. */
export interface SourceInfoFields {
  readonly name?: string;
  readonly map?: string;
  readonly folder?: string;
  readonly game?: string;
  readonly appId?: number;
  readonly players?: number;
  readonly maxPlayers?: number;
  readonly environment?: "l" | "w" | "m";
  readonly password?: boolean;
  readonly version?: string;
  readonly port?: number;
  readonly steamId?: bigint;
  readonly keywords?: string;
  readonly gameId?: bigint;
}

/** One A2S Player record. */
export interface PlayerFields {
  readonly name: string;
  readonly score?: number;
  readonly durationSeconds?: number;
}

const HEADER = [0xff, 0xff, 0xff, 0xff] as const;
const encoder = new TextEncoder();

function join(parts: readonly (Uint8Array | readonly number[])[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function cString(value: string | Uint8Array): Uint8Array {
  return join([typeof value === "string" ? encoder.encode(value) : value, [0]]);
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

/** Encodes a Source-format A2S Info response. */
export function sourceInfoPacket(fields: SourceInfoFields = {}): Uint8Array {
  const flags =
    (fields.port === undefined ? 0 : 0x80) |
    (fields.steamId === undefined ? 0 : 0x10) |
    (fields.keywords === undefined ? 0 : 0x20) |
    (fields.gameId === undefined ? 0 : 0x01);
  return join([
    HEADER,
    [0x49, 17],
    cString(fields.name ?? "QueryHost Packet Fixture"),
    cString(fields.map ?? "map"),
    cString(fields.folder ?? "folder"),
    cString(fields.game ?? "Game"),
    uint16(fields.appId ?? 0),
    [fields.players ?? 0, fields.maxPlayers ?? 16, 0, 0x64],
    [(fields.environment ?? "l").charCodeAt(0), fields.password === true ? 1 : 0, 0],
    cString(fields.version ?? "1.0.0.0"),
    ...(flags === 0 ? [] : [[flags]]),
    ...(fields.port === undefined ? [] : [uint16(fields.port)]),
    ...(fields.steamId === undefined ? [] : [uint64(fields.steamId)]),
    ...(fields.keywords === undefined ? [] : [cString(fields.keywords)]),
    ...(fields.gameId === undefined ? [] : [uint64(fields.gameId)]),
  ]);
}

/** Encodes an A2S Rules response; byte keys and values carry binary rule pages. */
export function rulesPacket(
  entries: readonly (readonly [string | Uint8Array, string | Uint8Array])[],
): Uint8Array {
  return join([
    HEADER,
    [0x45],
    uint16(entries.length),
    ...entries.flatMap(([key, value]) => [cString(key), cString(value)]),
  ]);
}

/** Encodes an A2S Player response. */
export function playersPacket(players: readonly PlayerFields[]): Uint8Array {
  return join([
    HEADER,
    [0x44, players.length],
    ...players.map((player, index) => {
      const numbers = new Uint8Array(8);
      const view = new DataView(numbers.buffer);
      view.setInt32(0, player.score ?? 0, true);
      view.setFloat32(4, player.durationSeconds ?? 0, true);
      return join([[index], cString(player.name), numbers]);
    }),
  ]);
}

/** Answers Info, Player, and Rules with the given packets; omitted Player or Rules time out. */
export function packetA2s(packets: {
  readonly info: Uint8Array;
  readonly players?: Uint8Array;
  readonly rules?: Uint8Array;
}): A2sExchangeDependencies {
  return {
    collect(options): Promise<UdpCollectionResult> {
      const data =
        packetType(options) === 0x54
          ? packets.info
          : packetType(options) === 0x55
            ? packets.players
            : packetType(options) === 0x56
              ? packets.rules
              : undefined;
      if (data === undefined) {
        return Promise.reject(new UdpTransportError("TIMEOUT"));
      }
      return Promise.resolve({
        datagrams: Object.freeze([data]),
        rttMs: 1,
        address: options.address,
        port: options.target.port,
      });
    },
  };
}
