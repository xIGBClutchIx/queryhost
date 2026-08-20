/** A2S Info request encoding, strict response parsing, and bounded challenge orchestration. */

import { A2sBinaryReader } from "./binary.js";
import { failA2s } from "./errors.js";
import { exchangeA2s, type A2sExchangeDependencies, type A2sQueryOptions } from "./network.js";
import { A2S_MAX_DATAGRAM_BYTES, A2S_MAX_RESPONSE_BYTES } from "./split.js";

const SINGLE_PACKET_HEADER = -1;
const SPLIT_PACKET_HEADER = -2;
const S2C_CHALLENGE = 0x41;
const S2A_INFO_SOURCE = 0x49;
const S2A_INFO_GOLDSOURCE = 0x6d;
const EDF_PORT = 0x80;
const EDF_STEAM_ID = 0x10;
const EDF_SOURCE_TV = 0x40;
const EDF_KEYWORDS = 0x20;
const EDF_GAME_ID = 0x01;
const KNOWN_EDF_MASK = EDF_PORT | EDF_STEAM_ID | EDF_SOURCE_TV | EDF_KEYWORDS | EDF_GAME_ID;

/** Maximum single-packet A2S response accepted by the direct parser. */
export const A2S_SINGLE_PACKET_MAX_BYTES: number = A2S_MAX_DATAGRAM_BYTES;

const BASE_INFO_REQUEST = Uint8Array.of(
  0xff,
  0xff,
  0xff,
  0xff,
  0x54,
  0x53,
  0x6f,
  0x75,
  0x72,
  0x63,
  0x65,
  0x20,
  0x45,
  0x6e,
  0x67,
  0x69,
  0x6e,
  0x65,
  0x20,
  0x51,
  0x75,
  0x65,
  0x72,
  0x79,
  0x00,
);

/** Normalized A2S server process type. */
export type A2sServerType = "dedicated" | "listen" | "proxy";

/** Normalized operating-system family advertised by an A2S server. */
export type A2sEnvironment = "linux" | "macos" | "windows";

/** Optional SourceTV endpoint advertised through the EDF byte. */
export interface A2sSourceTv {
  readonly port: number;
  readonly name: string;
}

/** Modern Source-style A2S Info response. */
export interface A2sSourceInfo {
  readonly format: "source";
  readonly protocol: number;
  readonly name: string;
  readonly map: string;
  readonly folder: string;
  readonly game: string;
  readonly appId: number;
  readonly players: number;
  readonly maxPlayers: number;
  readonly bots: number;
  readonly serverType: A2sServerType;
  readonly environment: A2sEnvironment;
  readonly password: boolean;
  readonly vac: boolean;
  readonly version: string;
  readonly extraDataFlags?: number;
  readonly port?: number;
  readonly steamId?: bigint;
  readonly sourceTv?: A2sSourceTv;
  readonly keywords?: string;
  readonly gameId?: bigint;
}

/** GoldSource mod metadata present only when the legacy response marks itself as a mod. */
export interface A2sGoldSourceMod {
  readonly link: string;
  readonly downloadLink: string;
  readonly version: number;
  readonly size: number;
  readonly multiplayerOnly: boolean;
  readonly usesHalfLifeDll: boolean;
}

/** Legacy GoldSource-style A2S Info response. */
export interface A2sGoldSourceInfo {
  readonly format: "goldsource";
  readonly address: string;
  readonly name: string;
  readonly map: string;
  readonly folder: string;
  readonly game: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly protocol: number;
  readonly serverType: A2sServerType;
  readonly environment: A2sEnvironment;
  readonly password: boolean;
  readonly mod?: A2sGoldSourceMod;
  readonly vac: boolean;
  readonly bots: number;
}

/** Either response layout accepted by A2S Info. */
export type A2sInfo = A2sSourceInfo | A2sGoldSourceInfo;

/** Parsed single-packet response before challenge orchestration. */
export type A2sInfoPacket =
  | { readonly kind: "challenge"; readonly challenge: number }
  | { readonly kind: "info"; readonly info: A2sInfo };

/** Dependencies required to perform A2S Info network exchanges. */
export type A2sInfoDependencies = A2sExchangeDependencies;

/** Inputs for a direct A2S Info query against one selected pinned address. */
export type A2sInfoQueryOptions = A2sQueryOptions;

/** Parsed A2S information and the complete request/challenge round-trip duration. */
export interface A2sInfoQueryResult {
  readonly info: A2sInfo;
  readonly rttMs: number;
  readonly challenged: boolean;
}

function readBoolean(reader: A2sBinaryReader): boolean {
  const value = reader.readUint8();
  if (value !== 0 && value !== 1) {
    return failA2s("MALFORMED_RESPONSE");
  }
  return value === 1;
}

function readServerType(reader: A2sBinaryReader): A2sServerType {
  const value = reader.readUint8();
  if (value === 0x64) {
    return "dedicated";
  }
  if (value === 0x6c) {
    return "listen";
  }
  if (value === 0x70) {
    return "proxy";
  }
  return failA2s("MALFORMED_RESPONSE");
}

function readEnvironment(reader: A2sBinaryReader): A2sEnvironment {
  const value = reader.readUint8();
  if (value === 0x6c) {
    return "linux";
  }
  if (value === 0x77) {
    return "windows";
  }
  if (value === 0x6d || value === 0x6f) {
    return "macos";
  }
  return failA2s("MALFORMED_RESPONSE");
}

function parseSourceInfo(reader: A2sBinaryReader): A2sSourceInfo {
  const protocol = reader.readUint8();
  const name = reader.readString();
  const map = reader.readString();
  const folder = reader.readString();
  const game = reader.readString();
  const appId = reader.readUint16();
  const players = reader.readUint8();
  const maxPlayers = reader.readUint8();
  const bots = reader.readUint8();
  const serverType = readServerType(reader);
  const environment = readEnvironment(reader);
  const password = readBoolean(reader);
  const vac = readBoolean(reader);
  const version = reader.readString();

  if (reader.remaining === 0) {
    return {
      format: "source",
      protocol,
      name,
      map,
      folder,
      game,
      appId,
      players,
      maxPlayers,
      bots,
      serverType,
      environment,
      password,
      vac,
      version,
    };
  }

  const extraDataFlags = reader.readUint8();
  if ((extraDataFlags & ~KNOWN_EDF_MASK) !== 0) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const port = (extraDataFlags & EDF_PORT) === 0 ? undefined : reader.readUint16();
  const steamId = (extraDataFlags & EDF_STEAM_ID) === 0 ? undefined : reader.readUint64();
  const sourceTv =
    (extraDataFlags & EDF_SOURCE_TV) === 0
      ? undefined
      : { port: reader.readUint16(), name: reader.readString() };
  const keywords = (extraDataFlags & EDF_KEYWORDS) === 0 ? undefined : reader.readString();
  const gameId = (extraDataFlags & EDF_GAME_ID) === 0 ? undefined : reader.readUint64();
  reader.expectEnd();

  return {
    format: "source",
    protocol,
    name,
    map,
    folder,
    game,
    appId,
    players,
    maxPlayers,
    bots,
    serverType,
    environment,
    password,
    vac,
    version,
    extraDataFlags,
    ...(port === undefined ? {} : { port }),
    ...(steamId === undefined ? {} : { steamId }),
    ...(sourceTv === undefined ? {} : { sourceTv }),
    ...(keywords === undefined ? {} : { keywords }),
    ...(gameId === undefined ? {} : { gameId }),
  };
}

function parseGoldSourceMod(reader: A2sBinaryReader): A2sGoldSourceMod {
  const link = reader.readString();
  const downloadLink = reader.readString();
  if (reader.readUint8() !== 0) {
    return failA2s("MALFORMED_RESPONSE");
  }
  return {
    link,
    downloadLink,
    version: reader.readUint32(),
    size: reader.readUint32(),
    multiplayerOnly: readBoolean(reader),
    usesHalfLifeDll: readBoolean(reader),
  };
}

function parseGoldSourceInfo(reader: A2sBinaryReader): A2sGoldSourceInfo {
  const address = reader.readString();
  const name = reader.readString();
  const map = reader.readString();
  const folder = reader.readString();
  const game = reader.readString();
  const players = reader.readUint8();
  const maxPlayers = reader.readUint8();
  const protocol = reader.readUint8();
  const serverType = readServerType(reader);
  const environment = readEnvironment(reader);
  const password = readBoolean(reader);
  const isMod = readBoolean(reader);
  const mod = isMod ? parseGoldSourceMod(reader) : undefined;
  const vac = readBoolean(reader);
  const bots = reader.readUint8();
  reader.expectEnd();

  return {
    format: "goldsource",
    address,
    name,
    map,
    folder,
    game,
    players,
    maxPlayers,
    protocol,
    serverType,
    environment,
    password,
    ...(mod === undefined ? {} : { mod }),
    vac,
    bots,
  };
}

/** Encodes the fixed A2S Info request and an optional signed 32-bit challenge token. */
export function encodeA2sInfoRequest(challenge?: number): Uint8Array {
  if (challenge === undefined) {
    return Uint8Array.from(BASE_INFO_REQUEST);
  }
  if (!Number.isInteger(challenge) || challenge < -2_147_483_648 || challenge > 2_147_483_647) {
    return failA2s("INVALID_INPUT");
  }

  const request = new Uint8Array(BASE_INFO_REQUEST.byteLength + 4);
  request.set(BASE_INFO_REQUEST);
  new DataView(request.buffer).setInt32(BASE_INFO_REQUEST.byteLength, challenge, true);
  return request;
}

function parseA2sInfoResponse(packet: Uint8Array, maximumBytes: number): A2sInfoPacket {
  if (packet.byteLength < 5 || packet.byteLength > maximumBytes) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const reader = new A2sBinaryReader(packet);
  const header = reader.readInt32();
  if (header === SPLIT_PACKET_HEADER) {
    return failA2s("SPLIT_PACKET");
  }
  if (header !== SINGLE_PACKET_HEADER) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const responseType = reader.readUint8();
  if (responseType === S2C_CHALLENGE) {
    const challenge = reader.readInt32();
    reader.expectEnd();
    return { kind: "challenge", challenge };
  }
  if (responseType === S2A_INFO_SOURCE) {
    return { kind: "info", info: parseSourceInfo(reader) };
  }
  if (responseType === S2A_INFO_GOLDSOURCE) {
    return { kind: "info", info: parseGoldSourceInfo(reader) };
  }
  return failA2s("MALFORMED_RESPONSE");
}

/** Parses one bounded, unsplit A2S Info or challenge packet. */
export function parseA2sInfoPacket(packet: Uint8Array): A2sInfoPacket {
  return parseA2sInfoResponse(packet, A2S_SINGLE_PACKET_MAX_BYTES);
}

async function exchange(
  options: A2sInfoQueryOptions,
  request: Uint8Array,
  dependencies?: A2sInfoDependencies,
): Promise<{ readonly packet: A2sInfoPacket; readonly rttMs: number }> {
  const result = await exchangeA2s(options, request, dependencies);
  return { packet: parseA2sInfoResponse(result.data, A2S_MAX_RESPONSE_BYTES), rttMs: result.rttMs };
}

/** Performs a direct A2S Info query with at most one server-requested challenge retry. */
export async function queryA2sInfo(
  options: A2sInfoQueryOptions,
  dependencies?: A2sInfoDependencies,
): Promise<A2sInfoQueryResult> {
  const firstResponse = await exchange(options, encodeA2sInfoRequest(), dependencies);
  const firstPacket = firstResponse.packet;
  if (firstPacket.kind === "info") {
    return { info: firstPacket.info, rttMs: firstResponse.rttMs, challenged: false };
  }

  const secondResponse = await exchange(
    options,
    encodeA2sInfoRequest(firstPacket.challenge),
    dependencies,
  );
  const secondPacket = secondResponse.packet;
  if (secondPacket.kind === "challenge") {
    return failA2s("CHALLENGE_LIMIT");
  }

  return {
    info: secondPacket.info,
    rttMs: firstResponse.rttMs + secondResponse.rttMs,
    challenged: true,
  };
}
