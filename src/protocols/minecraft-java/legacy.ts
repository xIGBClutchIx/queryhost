/** Minecraft Java legacy (pre-1.7) server list ping encoding and strict kick-packet parsing. */

import type { MinecraftMotd } from "../../contracts/games.js";
import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  tcpExchange,
  type TcpResponseState,
  type TcpTransportDependencies,
} from "../../transports/tcp.js";
import { failMinecraftJava } from "./errors.js";
import { normalizeMinecraftMotd } from "./motd.js";

const PING_PACKET_ID = 0xfe;
const PING_PAYLOAD = 0x01;
const PLUGIN_MESSAGE_PACKET_ID = 0xfa;
const KICK_PACKET_ID = 0xff;
const PING_CHANNEL = "MC|PingHost";
/** Protocol 74 (1.6.2); servers before 1.6 stop reading after `FE 01` and ignore the rest. */
const PING_PROTOCOL_VERSION = 74;
const MAX_HOSTNAME_CHARACTERS = 255;
/**
 * Vanilla clients cap the kick reason at 256 characters; the extra headroom accepts long
 * formatted MOTDs from proxies without letting a response grow unbounded.
 */
const MAX_RESPONSE_CHARACTERS = 2_048;
const MODERN_PREFIX = "§1\u0000";
const MAX_INT32 = 2_147_483_647;

/** Maximum kick packet retained by the legacy ping: id, length, and UTF-16 characters. */
export const MINECRAFT_LEGACY_MAX_RESPONSE_BYTES: number = 3 + MAX_RESPONSE_CHARACTERS * 2;

/**
 * Facts parsed from one legacy ping response.
 *
 * Beta 1.8 through 1.3 report only MOTD and player counts, so version and protocol stay omitted.
 * Servers from 1.4 onward, including modern servers answering a legacy ping, report both.
 */
export interface MinecraftJavaLegacyStatus {
  readonly versionName?: string;
  readonly protocolVersion?: number;
  readonly playersOnline: number;
  readonly playersMax: number;
  readonly motd: MinecraftMotd;
}

/** Inputs for one legacy ping against one already validated address. */
export interface MinecraftJavaLegacyQueryOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Parsed legacy status and complete connect/request/response round-trip duration. */
export interface MinecraftJavaLegacyQueryResult {
  readonly status: MinecraftJavaLegacyStatus;
  readonly rttMs: number;
}

function utf16be(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(index * 2, value.charCodeAt(index));
  }
  return bytes;
}

/** Encodes the 1.6 ping (`FE 01` plus an `MC|PingHost` plugin message) older servers also accept. */
export function encodeMinecraftLegacyPing(hostname: string, port: number): Uint8Array {
  if (
    hostname.length === 0 ||
    hostname.length > MAX_HOSTNAME_CHARACTERS ||
    hostname.includes("\0") ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return failMinecraftJava("INVALID_INPUT");
  }
  const channel = utf16be(PING_CHANNEL);
  const host = utf16be(hostname);
  const dataLength = 1 + 2 + host.byteLength + 4;
  const bytes = new Uint8Array(3 + 2 + channel.byteLength + 2 + dataLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  bytes.set([PING_PACKET_ID, PING_PAYLOAD, PLUGIN_MESSAGE_PACKET_ID], offset);
  offset += 3;
  view.setUint16(offset, PING_CHANNEL.length);
  offset += 2;
  bytes.set(channel, offset);
  offset += channel.byteLength;
  view.setUint16(offset, dataLength);
  offset += 2;
  view.setUint8(offset, PING_PROTOCOL_VERSION);
  offset += 1;
  view.setUint16(offset, hostname.length);
  offset += 2;
  bytes.set(host, offset);
  offset += host.byteLength;
  view.setInt32(offset, port);
  return bytes;
}

/** Inspects the kick packet header so fragmented TCP reads remain valid. */
export function inspectMinecraftLegacyResponse(data: Uint8Array): TcpResponseState {
  if (data.byteLength === 0) {
    return "incomplete";
  }
  if (data[0] !== KICK_PACKET_ID) {
    return "malformed";
  }
  if (data.byteLength < 3) {
    return "incomplete";
  }
  const characters = ((data[1] ?? 0) << 8) | (data[2] ?? 0);
  if (characters === 0) {
    return "malformed";
  }
  if (characters > MAX_RESPONSE_CHARACTERS) {
    return "too-large";
  }
  const expectedBytes = 3 + characters * 2;
  if (data.byteLength < expectedBytes) {
    return "incomplete";
  }
  return data.byteLength === expectedBytes ? "complete" : "malformed";
}

function decodeUtf16be(bytes: Uint8Array): string {
  const swapped = new Uint8Array(bytes.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 2) {
    swapped[index] = bytes[index + 1] ?? 0;
    swapped[index + 1] = bytes[index] ?? 0;
  }
  try {
    return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  } catch {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
}

function count(value: string | undefined): number {
  if (value === undefined || !/^[0-9]{1,10}$/u.test(value)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const parsed = Number(value);
  return parsed <= MAX_INT32 ? parsed : failMinecraftJava("MALFORMED_RESPONSE");
}

function protocol(value: string | undefined): number {
  if (value === undefined || !/^-?[0-9]{1,10}$/u.test(value)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const parsed = Number(value);
  return parsed >= -MAX_INT32 - 1 && parsed <= MAX_INT32
    ? parsed
    : failMinecraftJava("MALFORMED_RESPONSE");
}

/** Parses one exact kick packet in either the 1.4+ (`§1`) or Beta 1.8 to 1.3 layout. */
export function parseMinecraftLegacyResponse(data: Uint8Array): MinecraftJavaLegacyStatus {
  const framing = inspectMinecraftLegacyResponse(data);
  if (framing !== "complete") {
    return failMinecraftJava(framing === "too-large" ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE");
  }
  const text = decodeUtf16be(data.subarray(3));
  if (text.startsWith(MODERN_PREFIX)) {
    const fields = text.slice(MODERN_PREFIX.length).split("\u0000");
    if (fields.length !== 5) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    const [protocolVersion, versionName, motd, online, max] = fields;
    return Object.freeze({
      versionName: versionName ?? failMinecraftJava("MALFORMED_RESPONSE"),
      protocolVersion: protocol(protocolVersion),
      playersOnline: count(online),
      playersMax: count(max),
      motd: normalizeMinecraftMotd(motd ?? ""),
    });
  }
  // The old layout separates fields with `§`, so its MOTD cannot carry formatting codes. Counts
  // are always the last two fields; anything before them is the MOTD.
  if (text.includes("\u0000")) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const fields = text.split("§");
  if (fields.length !== 3) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const [motd, online, max] = fields;
  return Object.freeze({
    playersOnline: count(online),
    playersMax: count(max),
    motd: normalizeMinecraftMotd(motd ?? ""),
  });
}

/** Performs one bounded legacy ping over the shared TCP transport. */
export async function queryMinecraftLegacyStatus(
  options: MinecraftJavaLegacyQueryOptions,
  dependencies?: TcpTransportDependencies,
): Promise<MinecraftJavaLegacyQueryResult> {
  const exchangeOptions = {
    ...options,
    request: encodeMinecraftLegacyPing(options.target.hostname, options.target.port),
    maxResponseBytes: MINECRAFT_LEGACY_MAX_RESPONSE_BYTES,
    inspectResponse: inspectMinecraftLegacyResponse,
  };
  const result =
    dependencies === undefined
      ? await tcpExchange(exchangeOptions)
      : await tcpExchange(exchangeOptions, dependencies);
  return Object.freeze({ status: parseMinecraftLegacyResponse(result.data), rttMs: result.rttMs });
}
