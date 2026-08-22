/** Minecraft Java UDP Query challenge, stat framing, parsing, and bounded network exchange. */

import type { MinecraftPlugin, MinecraftSoftware } from "../../contracts/games.js";
import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  udpConversation,
  type UdpConversationOptions,
  type UdpConversationResult,
} from "../../transports/udp.js";
import { failMinecraftJava } from "./errors.js";

const MAGIC = Uint8Array.of(0xfe, 0xfd);
const HANDSHAKE_TYPE = 0x09;
const STAT_TYPE = 0x00;
const FULL_STAT_HEADER = Uint8Array.of(
  0x73,
  0x70,
  0x6c,
  0x69,
  0x74,
  0x6e,
  0x75,
  0x6d,
  0x00,
  0x80,
  0x00,
);
const PLAYER_SECTION = Uint8Array.of(0x01, 0x70, 0x6c, 0x61, 0x79, 0x65, 0x72, 0x5f, 0x00, 0x00);
const MAX_RESPONSE_BYTES = 32_768;
const MAX_TOTAL_RESPONSE_BYTES = MAX_RESPONSE_BYTES + 64;
const MAX_FIELDS = 128;
const MAX_KEY_BYTES = 64;
const MAX_VALUE_BYTES = 4_096;
const MAX_PLAYERS = 1_024;
const MAX_PLAYER_BYTES = 256;
const MAX_PLUGINS = 512;
const LATIN1 = new TextDecoder("latin1");

/** Parsed facts provided by a basic or full Minecraft Query stat response. */
export interface MinecraftQueryStat {
  readonly format: "basic" | "full";
  readonly motd?: string;
  readonly gameType?: string;
  readonly map?: string;
  readonly playersOnline?: number;
  readonly playersMax?: number;
  readonly hostPort?: number;
  readonly hostIp?: string;
  readonly version?: string;
  readonly software?: MinecraftSoftware;
  /** Omitted without a plugin list field; empty means Query confirmed no plugins. */
  readonly plugins?: readonly MinecraftPlugin[];
  /** Available only in full-stat responses; empty means Query confirmed no listed players. */
  readonly players?: readonly string[];
}

/** Inputs for one optional Query exchange against the selected Minecraft target. */
export interface MinecraftQueryOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  readonly sessionId: number;
}

/** Complete optional Query result and challenge/stat round-trip duration. */
export interface MinecraftQueryResult {
  readonly stat: MinecraftQueryStat;
  readonly rttMs: number;
}

/** Injectable same-socket conversation boundary used by protocol and profile tests. */
export interface MinecraftQueryDependencies {
  readonly converse: (options: UdpConversationOptions) => Promise<UdpConversationResult>;
}

const DEFAULT_DEPENDENCIES: MinecraftQueryDependencies = {
  converse: udpConversation,
};

class QueryReader {
  readonly #data: Uint8Array;
  #offset = 0;

  public constructor(data: Uint8Array) {
    this.#data = data;
  }

  public get remaining(): number {
    return this.#data.byteLength - this.#offset;
  }

  public byte(): number {
    const value = this.#data[this.#offset];
    if (value === undefined) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    this.#offset += 1;
    return value;
  }

  public int32(): number {
    if (this.remaining < 4) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    const value = new DataView(this.#data.buffer, this.#data.byteOffset + this.#offset, 4).getInt32(
      0,
    );
    this.#offset += 4;
    return value;
  }

  public uint16LittleEndian(): number {
    if (this.remaining < 2) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    const value = new DataView(
      this.#data.buffer,
      this.#data.byteOffset + this.#offset,
      2,
    ).getUint16(0, true);
    this.#offset += 2;
    return value;
  }

  public expect(expected: Uint8Array): void {
    if (this.remaining < expected.byteLength) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    for (const value of expected) {
      if (this.byte() !== value) {
        failMinecraftJava("MALFORMED_RESPONSE");
      }
    }
  }

  public string(maximumBytes: number): string {
    const start = this.#offset;
    while (this.#offset < this.#data.byteLength && this.#data[this.#offset] !== 0) {
      this.#offset += 1;
      if (this.#offset - start > maximumBytes) {
        return failMinecraftJava("RESPONSE_TOO_LARGE");
      }
    }
    if (this.#offset >= this.#data.byteLength) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    const value = LATIN1.decode(this.#data.subarray(start, this.#offset));
    this.#offset += 1;
    return value;
  }
}

function validateSessionId(sessionId: number): number {
  if (!Number.isSafeInteger(sessionId) || sessionId < 0 || sessionId > 0x0f0f_0f0f) {
    return failMinecraftJava("INVALID_INPUT");
  }
  return sessionId;
}

function packet(type: number, sessionId: number, suffix = new Uint8Array()): Uint8Array {
  const result = new Uint8Array(7 + suffix.byteLength);
  result.set(MAGIC);
  result[2] = type;
  new DataView(result.buffer).setInt32(3, validateSessionId(sessionId));
  result.set(suffix, 7);
  return result;
}

/** Creates the Query session identifier mask used by vanilla-compatible servers. */
export function createMinecraftQuerySessionId(random: () => number): number {
  const fraction = random();
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) {
    return failMinecraftJava("INVALID_INPUT");
  }
  return (Math.floor(fraction * 0x1_0000_0000) & 0x0f0f_0f0f) >>> 0;
}

/** Encodes the Query challenge request. */
export function encodeMinecraftQueryHandshake(sessionId: number): Uint8Array {
  return packet(HANDSHAKE_TYPE, sessionId);
}

/** Parses and validates one challenge token response. */
export function parseMinecraftQueryChallenge(data: Uint8Array, sessionId: number): number {
  const reader = new QueryReader(data);
  if (reader.byte() !== HANDSHAKE_TYPE || reader.int32() !== validateSessionId(sessionId)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const token = reader.string(11);
  if (reader.remaining !== 0 || !/^-?(?:0|[1-9][0-9]{0,9})$/u.test(token)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const value = Number(token);
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return value;
}

/** Encodes the full-stat request with the challenge token and required padding. */
export function encodeMinecraftQueryFullStat(
  sessionId: number,
  challengeToken: number,
): Uint8Array {
  if (
    !Number.isSafeInteger(challengeToken) ||
    challengeToken < -2_147_483_648 ||
    challengeToken > 2_147_483_647
  ) {
    return failMinecraftJava("INVALID_INPUT");
  }
  const suffix = new Uint8Array(8);
  new DataView(suffix.buffer).setInt32(0, challengeToken);
  return packet(STAT_TYPE, sessionId, suffix);
}

function optionalValue(fields: Readonly<Record<string, string>>, key: string): string | undefined {
  const value = fields[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

function optionalCount(fields: Readonly<Record<string, string>>, key: string): number | undefined {
  const value = optionalValue(fields, key);
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(value)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return parsed;
}

function plugin(value: string): MinecraftPlugin {
  const trimmed = value.trim();
  const separator = trimmed.lastIndexOf(" ");
  if (separator > 0) {
    const name = trimmed.slice(0, separator).trim();
    const version = trimmed.slice(separator + 1).trim();
    if (name.length > 0 && /^(?=.*[0-9])[a-z0-9][a-z0-9._+-]*$/iu.test(version)) {
      return Object.freeze({ name, version });
    }
  }
  return Object.freeze({ name: trimmed });
}

function pluginMetadata(value: string | undefined): {
  readonly software?: MinecraftSoftware;
  readonly plugins?: readonly MinecraftPlugin[];
} {
  if (value === undefined) {
    return Object.freeze({});
  }
  const separator = value.indexOf(":");
  const softwareName = (separator < 0 ? value : value.slice(0, separator)).trim();
  if (separator < 0) {
    return softwareName.length === 0
      ? Object.freeze({ plugins: Object.freeze([]) })
      : Object.freeze({ software: Object.freeze({ name: softwareName }) });
  }
  const entries = value
    .slice(separator + 1)
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length > MAX_PLUGINS) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  const plugins = Object.freeze(entries.map(plugin));
  return Object.freeze({
    ...(softwareName.length === 0 ? {} : { software: Object.freeze({ name: softwareName }) }),
    plugins,
  });
}

function parseBasic(reader: QueryReader): MinecraftQueryStat {
  const motd = reader.string(MAX_VALUE_BYTES);
  const gameType = reader.string(MAX_VALUE_BYTES);
  const map = reader.string(MAX_VALUE_BYTES);
  const playersOnlineText = reader.string(MAX_VALUE_BYTES);
  const playersMaxText = reader.string(MAX_VALUE_BYTES);
  const hostPort = reader.uint16LittleEndian();
  const hostIp = reader.string(MAX_VALUE_BYTES);
  if (reader.remaining !== 0) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const fields = {
    numplayers: playersOnlineText,
    maxplayers: playersMaxText,
  };
  const playersOnline = optionalCount(fields, "numplayers");
  const playersMax = optionalCount(fields, "maxplayers");
  return Object.freeze({
    format: "basic",
    ...(motd.length === 0 ? {} : { motd }),
    ...(gameType.length === 0 ? {} : { gameType }),
    ...(map.length === 0 ? {} : { map }),
    ...(playersOnline === undefined ? {} : { playersOnline }),
    ...(playersMax === undefined ? {} : { playersMax }),
    hostPort,
    ...(hostIp.length === 0 ? {} : { hostIp }),
  });
}

function parseFull(reader: QueryReader): MinecraftQueryStat {
  reader.expect(FULL_STAT_HEADER);
  const fields: Record<string, string> = {};
  let fieldsComplete = false;
  for (let fieldCount = 0; fieldCount <= MAX_FIELDS; fieldCount += 1) {
    const key = reader.string(MAX_KEY_BYTES);
    if (key.length === 0) {
      fieldsComplete = true;
      break;
    }
    if (fieldCount === MAX_FIELDS || fields[key] !== undefined) {
      return failMinecraftJava(
        fieldCount === MAX_FIELDS ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE",
      );
    }
    fields[key] = reader.string(MAX_VALUE_BYTES);
  }
  if (!fieldsComplete) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  reader.expect(PLAYER_SECTION);
  const players: string[] = [];
  let playersComplete = false;
  for (let playerCount = 0; playerCount <= MAX_PLAYERS; playerCount += 1) {
    const name = reader.string(MAX_PLAYER_BYTES);
    if (name.length === 0) {
      playersComplete = true;
      break;
    }
    if (playerCount === MAX_PLAYERS) {
      return failMinecraftJava("RESPONSE_TOO_LARGE");
    }
    players.push(name);
  }
  if (!playersComplete) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  if (reader.remaining !== 0) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const metadata = pluginMetadata(fields["plugins"]);
  const port = optionalCount(fields, "hostport");
  if (port !== undefined && (port < 1 || port > 65_535)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const motd = optionalValue(fields, "hostname");
  const gameType = optionalValue(fields, "gametype");
  const map = optionalValue(fields, "map");
  const playersOnline = optionalCount(fields, "numplayers");
  const playersMax = optionalCount(fields, "maxplayers");
  const hostIp = optionalValue(fields, "hostip");
  const version = optionalValue(fields, "version");
  return Object.freeze({
    format: "full",
    ...(motd === undefined ? {} : { motd }),
    ...(gameType === undefined ? {} : { gameType }),
    ...(map === undefined ? {} : { map }),
    ...(playersOnline === undefined ? {} : { playersOnline }),
    ...(playersMax === undefined ? {} : { playersMax }),
    ...(port === undefined ? {} : { hostPort: port }),
    ...(hostIp === undefined ? {} : { hostIp }),
    ...(version === undefined ? {} : { version }),
    ...metadata,
    players: Object.freeze(players),
  });
}

/** Parses one exact basic or full stat response for the expected session. */
export function parseMinecraftQueryStat(data: Uint8Array, sessionId: number): MinecraftQueryStat {
  if (data.byteLength > MAX_RESPONSE_BYTES) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  const reader = new QueryReader(data);
  if (reader.byte() !== STAT_TYPE || reader.int32() !== validateSessionId(sessionId)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  if (reader.remaining >= FULL_STAT_HEADER.byteLength) {
    const header = data.subarray(5, 5 + FULL_STAT_HEADER.byteLength);
    if (FULL_STAT_HEADER.every((value, index) => header[index] === value)) {
      return parseFull(reader);
    }
  }
  return parseBasic(reader);
}

/** Performs the same-socket challenge and full-stat exchange over bounded UDP. */
export async function queryMinecraftFullStat(
  options: MinecraftQueryOptions,
  dependencies: MinecraftQueryDependencies = DEFAULT_DEPENDENCIES,
): Promise<MinecraftQueryResult> {
  const conversation = await dependencies.converse({
    ...options,
    request: encodeMinecraftQueryHandshake(options.sessionId),
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxResponses: 2,
    maxTotalResponseBytes: MAX_TOTAL_RESPONSE_BYTES,
    nextRequest(responses): Uint8Array | undefined {
      if (responses.length === 1) {
        const response = responses[0];
        if (response === undefined) {
          return failMinecraftJava("MALFORMED_RESPONSE");
        }
        return encodeMinecraftQueryFullStat(
          options.sessionId,
          parseMinecraftQueryChallenge(response, options.sessionId),
        );
      }
      return responses.length === 2 ? undefined : failMinecraftJava("MALFORMED_RESPONSE");
    },
  });
  const statResponse = conversation.responses[1];
  if (statResponse === undefined) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return Object.freeze({
    stat: parseMinecraftQueryStat(statResponse, options.sessionId),
    rttMs: conversation.rttMs,
  });
}
