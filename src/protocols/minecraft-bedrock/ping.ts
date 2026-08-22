/** Minecraft Bedrock RakNet unconnected ping encoding, pong parsing, and bounded exchange. */

import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  udpExchange,
  type UdpExchangeOptions,
  type UdpExchangeResult,
} from "../../transports/udp.js";
import { failMinecraftBedrock } from "./errors.js";

const UNCONNECTED_PING_ID = 0x01;
const UNCONNECTED_PONG_ID = 0x1c;
const OFFLINE_MESSAGE_MAGIC = Uint8Array.of(
  0x00,
  0xff,
  0xff,
  0x00,
  0xfe,
  0xfe,
  0xfe,
  0xfe,
  0xfd,
  0xfd,
  0xfd,
  0xfd,
  0x12,
  0x34,
  0x56,
  0x78,
);
const UINT64_MAX = 0xffff_ffff_ffff_ffffn;
const MAX_RESPONSE_BYTES = 2_048;
const PONG_HEADER_BYTES = 35;
const MAX_FIELDS = 32;
const MAX_FIELD_BYTES = 1_024;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** Parsed semicolon fields and RakNet identifiers from one unconnected pong. */
export interface MinecraftBedrockPong {
  readonly pingTimestamp: bigint;
  readonly serverGuid: bigint;
  readonly edition: string;
  readonly motd?: string;
  readonly protocolVersion?: number;
  readonly version?: string;
  readonly playersOnline?: number;
  readonly playersMax?: number;
  readonly serverId?: string;
  readonly gameMode?: string;
  readonly advertisedIpv4Port?: number;
  readonly advertisedIpv6Port?: number;
}

/** Inputs for one RakNet ping against one validated and pinned address. */
export interface MinecraftBedrockPingOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  readonly pingTimestamp: bigint;
  readonly clientGuid: bigint;
}

/** Parsed pong plus transport round-trip time. */
export interface MinecraftBedrockPingResult {
  readonly pong: MinecraftBedrockPong;
  readonly rttMs: number;
}

/** Injectable single-datagram exchange boundary used by profile and protocol tests. */
export interface MinecraftBedrockPingDependencies {
  readonly exchange: (options: UdpExchangeOptions) => Promise<UdpExchangeResult>;
}

const DEFAULT_DEPENDENCIES: MinecraftBedrockPingDependencies = {
  exchange: udpExchange,
};

function uint64(value: bigint): bigint {
  if (value < 0n || value > UINT64_MAX) {
    return failMinecraftBedrock("INVALID_INPUT");
  }
  return value;
}

function exactMagic(data: Uint8Array, offset: number): boolean {
  return OFFLINE_MESSAGE_MAGIC.every((value, index) => data[offset + index] === value);
}

function optionalText(fields: readonly string[], index: number): string | undefined {
  const value = fields[index];
  return value === undefined || value.length === 0 ? undefined : value;
}

function optionalUnsignedInteger(
  fields: readonly string[],
  index: number,
  maximum: number,
): number | undefined {
  const value = optionalText(fields, index);
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  return parsed;
}

function optionalPort(fields: readonly string[], index: number): number | undefined {
  const port = optionalUnsignedInteger(fields, index, 65_535);
  if (port === 0) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  return port;
}

function optionalServerId(fields: readonly string[]): string | undefined {
  const value = optionalText(fields, 6);
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  try {
    if (BigInt(value) > UINT64_MAX) {
      return failMinecraftBedrock("MALFORMED_RESPONSE");
    }
  } catch {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  return value;
}

function semicolonFields(payload: Uint8Array): readonly string[] {
  let decoded: string;
  try {
    decoded = UTF8.decode(payload);
  } catch {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const fields = decoded.split(";");
  // A conventional trailing delimiter does not advertise another field.
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length === 0 || fields.length > MAX_FIELDS) {
    return failMinecraftBedrock(
      fields.length > MAX_FIELDS ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE",
    );
  }
  for (const field of fields) {
    if (UTF8_ENCODER.encode(field).byteLength > MAX_FIELD_BYTES) {
      return failMinecraftBedrock("RESPONSE_TOO_LARGE");
    }
  }
  return Object.freeze(fields);
}

function randomWord(random: () => number): bigint {
  const fraction = random();
  if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) {
    return failMinecraftBedrock("INVALID_INPUT");
  }
  return BigInt(Math.floor(fraction * 0x1_0000_0000));
}

/** Creates an unsigned 64-bit client GUID from an injectable random source. */
export function createMinecraftBedrockClientGuid(random: () => number): bigint {
  return (randomWord(random) << 32n) | randomWord(random);
}

/** Encodes the exact 33-byte RakNet unconnected ping request. */
export function encodeMinecraftBedrockPing(pingTimestamp: bigint, clientGuid: bigint): Uint8Array {
  const result = new Uint8Array(33);
  result[0] = UNCONNECTED_PING_ID;
  const view = new DataView(result.buffer);
  view.setBigUint64(1, uint64(pingTimestamp));
  result.set(OFFLINE_MESSAGE_MAGIC, 9);
  view.setBigUint64(25, uint64(clientGuid));
  return result;
}

/** Parses one exact, bounded RakNet unconnected pong for the expected ping identifier. */
export function parseMinecraftBedrockPong(
  data: Uint8Array,
  expectedPingTimestamp: bigint,
): MinecraftBedrockPong {
  if (data.byteLength > MAX_RESPONSE_BYTES) {
    return failMinecraftBedrock("RESPONSE_TOO_LARGE");
  }
  if (data.byteLength < PONG_HEADER_BYTES || data[0] !== UNCONNECTED_PONG_ID) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pingTimestamp = view.getBigUint64(1);
  const serverGuid = view.getBigUint64(9);
  if (pingTimestamp !== uint64(expectedPingTimestamp) || !exactMagic(data, 17)) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const payloadLength = view.getUint16(33);
  if (payloadLength !== data.byteLength - PONG_HEADER_BYTES) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const fields = semicolonFields(data.subarray(PONG_HEADER_BYTES));
  const edition = optionalText(fields, 0);
  if (edition !== "MCPE" && edition !== "MCEE") {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const protocolVersion = optionalUnsignedInteger(fields, 2, 2_147_483_647);
  const playersOnline = optionalUnsignedInteger(fields, 4, 2_147_483_647);
  const playersMax = optionalUnsignedInteger(fields, 5, 2_147_483_647);
  // Validate the numeric game-mode field even though the stable data contract exposes its name.
  optionalUnsignedInteger(fields, 9, 2_147_483_647);
  const serverId = optionalServerId(fields);
  const advertisedIpv4Port = optionalPort(fields, 10);
  const advertisedIpv6Port = optionalPort(fields, 11);
  const motd = optionalText(fields, 1);
  const version = optionalText(fields, 3);
  const gameMode = optionalText(fields, 8);
  return Object.freeze({
    pingTimestamp,
    serverGuid,
    edition,
    ...(motd === undefined ? {} : { motd }),
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    ...(version === undefined ? {} : { version }),
    ...(playersOnline === undefined ? {} : { playersOnline }),
    ...(playersMax === undefined ? {} : { playersMax }),
    ...(serverId === undefined ? {} : { serverId }),
    ...(gameMode === undefined ? {} : { gameMode }),
    ...(advertisedIpv4Port === undefined ? {} : { advertisedIpv4Port }),
    ...(advertisedIpv6Port === undefined ? {} : { advertisedIpv6Port }),
  });
}

/** Performs one bounded RakNet ping exchange against a pinned peer. */
export async function queryMinecraftBedrockPing(
  options: MinecraftBedrockPingOptions,
  dependencies: MinecraftBedrockPingDependencies = DEFAULT_DEPENDENCIES,
): Promise<MinecraftBedrockPingResult> {
  const exchange = await dependencies.exchange({
    scope: options.scope,
    target: options.target,
    address: options.address,
    request: encodeMinecraftBedrockPing(options.pingTimestamp, options.clientGuid),
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });
  return Object.freeze({
    pong: parseMinecraftBedrockPong(exchange.data, options.pingTimestamp),
    rttMs: exchange.rttMs,
  });
}
