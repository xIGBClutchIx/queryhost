/** Minecraft Java Server List Ping request encoding and strict status response parsing. */

import { crc32 } from "node:zlib";

import type { ExecutionScope } from "../../execution.js";
import type { MinecraftMotd } from "../../games.js";
import type { PinnedAddress, PinnedTarget } from "../../target.js";
import {
  tcpExchange,
  type TcpResponseState,
  type TcpTransportDependencies,
} from "../../transports/tcp.js";
import { failMinecraftJava, MinecraftJavaProtocolError } from "./errors.js";
import { isJsonObject, parseJson, type JsonObject, type JsonValue } from "./json.js";
import { normalizeMinecraftMotd } from "./motd.js";
import { encodeVarInt, readVarInt } from "./varint.js";

const STATUS_PACKET_ID = 0;
const STATUS_NEXT_STATE = 1;
const STATUS_PROTOCOL_VERSION = -1;
const MAX_JSON_BYTES = 262_144;
const MAX_JSON_CHARACTERS = 32_767;
const MAX_VERSION_NAME_CHARACTERS = 256;
const MAX_FAVICON_BYTES = 65_536;
const FAVICON_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const MAX_PNG_CHUNKS = 256;

/** Maximum framed status response retained by the Minecraft Java protocol. */
export const MINECRAFT_STATUS_MAX_RESPONSE_BYTES: number = MAX_JSON_BYTES + 16;

/** Parsed and normalized facts from one Minecraft Java status document. */
export interface MinecraftJavaStatus {
  readonly versionName: string;
  readonly protocolVersion: number;
  readonly playersOnline: number;
  readonly playersMax: number;
  readonly motd: MinecraftMotd;
  readonly favicon?: string;
}

/** Inputs for one status exchange against one already validated address. */
export interface MinecraftJavaStatusQueryOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Parsed status and complete connect/request/response round-trip duration. */
export interface MinecraftJavaStatusQueryResult {
  readonly status: MinecraftJavaStatus;
  readonly rttMs: number;
}

/** Injectable TCP boundaries used by profile and protocol tests. */
export type MinecraftJavaStatusDependencies = TcpTransportDependencies;

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function packet(payload: Uint8Array): Uint8Array {
  return concatBytes([encodeVarInt(payload.byteLength), payload]);
}

function protocolString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return concatBytes([encodeVarInt(encoded.byteLength), encoded]);
}

/** Encodes one status handshake followed immediately by an empty status request packet. */
export function encodeMinecraftStatusRequest(hostname: string, port: number): Uint8Array {
  const hostnameBytes = new TextEncoder().encode(hostname);
  if (
    hostname.length === 0 ||
    hostnameBytes.byteLength > 255 ||
    hostname.includes("\0") ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return failMinecraftJava("INVALID_INPUT");
  }
  const portBytes = Uint8Array.of((port >>> 8) & 0xff, port & 0xff);
  const handshake = packet(
    concatBytes([
      encodeVarInt(STATUS_PACKET_ID),
      encodeVarInt(STATUS_PROTOCOL_VERSION),
      protocolString(hostname),
      portBytes,
      encodeVarInt(STATUS_NEXT_STATE),
    ]),
  );
  const request = packet(encodeVarInt(STATUS_PACKET_ID));
  return concatBytes([handshake, request]);
}

/** Inspects only outer packet framing so fragmented TCP reads remain valid. */
export function inspectMinecraftStatusResponse(data: Uint8Array): TcpResponseState {
  try {
    const length = readVarInt(data);
    if (length.kind === "incomplete") {
      return "incomplete";
    }
    if (length.value < 1) {
      return "malformed";
    }
    if (length.value > MINECRAFT_STATUS_MAX_RESPONSE_BYTES - length.nextOffset) {
      return "too-large";
    }
    const expectedBytes = length.nextOffset + length.value;
    if (data.byteLength < expectedBytes) {
      return "incomplete";
    }
    return data.byteLength === expectedBytes ? "complete" : "malformed";
  } catch (error) {
    return error instanceof MinecraftJavaProtocolError && error.code === "RESPONSE_TOO_LARGE"
      ? "too-large"
      : "malformed";
  }
}

function requiredObject(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  return value !== undefined && isJsonObject(value)
    ? value
    : failMinecraftJava("MALFORMED_RESPONSE");
}

function requiredString(object: JsonObject, key: string, maximumCharacters: number): string {
  const value = object[key];
  if (typeof value !== "string" || value.length > maximumCharacters) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return value;
}

function requiredInteger(
  object: JsonObject,
  key: string,
  minimum: number,
  maximum: number,
): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return value;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

function validatePng(bytes: Uint8Array): void {
  if (!hasPngSignature(bytes)) {
    failMinecraftJava("MALFORMED_RESPONSE");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.byteLength;
  let chunks = 0;
  let sawHeader = false;
  let sawImageData = false;
  while (offset < bytes.byteLength) {
    chunks += 1;
    if (chunks > MAX_PNG_CHUNKS || offset + 12 > bytes.byteLength) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > bytes.byteLength) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    const type = pngChunkType(bytes, typeOffset);
    if (!/^[A-Za-z]{4}$/u.test(type)) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    const expectedCrc = view.getUint32(crcOffset);
    const actualCrc = crc32(bytes.subarray(typeOffset, crcOffset));
    if (actualCrc !== expectedCrc) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    if (chunks === 1) {
      if (type !== "IHDR" || length !== 13) {
        failMinecraftJava("MALFORMED_RESPONSE");
      }
      if (view.getUint32(dataOffset) !== 64 || view.getUint32(dataOffset + 4) !== 64) {
        failMinecraftJava("MALFORMED_RESPONSE");
      }
      sawHeader = true;
    } else if (type === "IHDR") {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    if (type === "IDAT") {
      sawImageData = true;
    }
    if (type === "IEND") {
      if (length !== 0 || !sawHeader || !sawImageData || nextOffset !== bytes.byteLength) {
        failMinecraftJava("MALFORMED_RESPONSE");
      }
      return;
    }
    offset = nextOffset;
  }
  failMinecraftJava("MALFORMED_RESPONSE");
}

function validateFavicon(value: JsonValue | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.startsWith(FAVICON_PREFIX)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const payload = value.slice(FAVICON_PREFIX.length);
  if (
    payload.length === 0 ||
    payload.length > Math.ceil(MAX_FAVICON_BYTES / 3) * 4 ||
    !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/iu.test(payload)
  ) {
    return failMinecraftJava(
      payload.length > Math.ceil(MAX_FAVICON_BYTES / 3) * 4
        ? "RESPONSE_TOO_LARGE"
        : "MALFORMED_RESPONSE",
    );
  }
  const bytes = Uint8Array.from(Buffer.from(payload, "base64"));
  if (bytes.byteLength > MAX_FAVICON_BYTES) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  validatePng(bytes);
  return value;
}

function statusDocument(value: JsonValue): MinecraftJavaStatus {
  if (!isJsonObject(value)) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const version = requiredObject(value, "version");
  const players = requiredObject(value, "players");
  const description = value["description"];
  if (description === undefined) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const favicon = validateFavicon(value["favicon"]);
  return Object.freeze({
    versionName: requiredString(version, "name", MAX_VERSION_NAME_CHARACTERS),
    protocolVersion: requiredInteger(version, "protocol", -2_147_483_648, 2_147_483_647),
    playersOnline: requiredInteger(players, "online", 0, 2_147_483_647),
    playersMax: requiredInteger(players, "max", 0, 2_147_483_647),
    motd: normalizeMinecraftMotd(description),
    ...(favicon === undefined ? {} : { favicon }),
  });
}

/** Parses one exact framed status response and validates its required document fields. */
export function parseMinecraftStatusResponse(data: Uint8Array): MinecraftJavaStatus {
  const framing = inspectMinecraftStatusResponse(data);
  if (framing !== "complete") {
    return failMinecraftJava(framing === "too-large" ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE");
  }
  const outer = readVarInt(data);
  if (outer.kind !== "value") {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const packetId = readVarInt(data, outer.nextOffset);
  if (packetId.kind !== "value" || packetId.value !== STATUS_PACKET_ID) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  const jsonLength = readVarInt(data, packetId.nextOffset);
  if (jsonLength.kind !== "value" || jsonLength.value < 0) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  if (jsonLength.value > MAX_JSON_BYTES) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  const jsonEnd = jsonLength.nextOffset + jsonLength.value;
  if (jsonEnd !== data.byteLength || outer.nextOffset + outer.value !== data.byteLength) {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(jsonLength.nextOffset));
  } catch {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  if (text.length > MAX_JSON_CHARACTERS) {
    return failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  return statusDocument(parseJson(text));
}

/** Performs one bounded status request over the shared TCP transport. */
export async function queryMinecraftStatus(
  options: MinecraftJavaStatusQueryOptions,
  dependencies?: MinecraftJavaStatusDependencies,
): Promise<MinecraftJavaStatusQueryResult> {
  const exchangeOptions = {
    ...options,
    request: encodeMinecraftStatusRequest(options.target.hostname, options.target.port),
    maxResponseBytes: MINECRAFT_STATUS_MAX_RESPONSE_BYTES,
    inspectResponse: inspectMinecraftStatusResponse,
  };
  const result =
    dependencies === undefined
      ? await tcpExchange(exchangeOptions)
      : await tcpExchange(exchangeOptions, dependencies);
  return Object.freeze({ status: parseMinecraftStatusResponse(result.data), rttMs: result.rttMs });
}
