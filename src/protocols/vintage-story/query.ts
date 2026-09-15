/** Vintage Story's bounded protobuf-like dedicated-server query exchange. */

import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  tcpExchange,
  type TcpResponseState,
  type TcpTransportDependencies,
} from "../../transports/tcp.js";
import { failVintageStory } from "./errors.js";

const FRAME_HEADER_BYTES = 4;
const QUERY_ANSWER_PACKET_ID = 28;
const DISCONNECT_PACKET_ID = 9;
const QUERY_COMPLETE = "Query complete";
const MAX_STRING_BYTES = 2_048;
const MAX_NAME_BYTES = 512;
const MAX_GAME_MODE_BYTES = 256;
const MAX_VERSION_BYTES = 128;

/** Maximum complete TCP frame accepted from a Vintage Story server. */
export const VINTAGE_STORY_MAX_RESPONSE_BYTES = 8_192;

/** Current stock servers acknowledge liveness; compatible servers may return status fields. */
export interface VintageStoryQueryAnswer {
  readonly kind: "liveness" | "status";
  readonly name?: string;
  readonly motd?: string;
  readonly playersOnline?: number;
  readonly playersMax?: number;
  readonly gameMode?: string;
  readonly password?: boolean;
  readonly version?: string;
}

/** Parsed query answer and complete connect/request/response round-trip duration. */
export interface VintageStoryQueryResult {
  readonly answer: VintageStoryQueryAnswer;
  readonly rttMs: number;
}

/** Inputs for one query against an address from an already validated target. */
export interface VintageStoryQueryOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Injectable TCP boundary used by deterministic profile and protocol tests. */
export type VintageStoryQueryDependencies = TcpTransportDependencies;

interface Key {
  readonly field: number;
  readonly wire: number;
}

class Cursor {
  public offset: number;
  private readonly bytes: Uint8Array;
  private readonly limit: number;

  public constructor(bytes: Uint8Array, start = 0, end = bytes.byteLength) {
    if (start < 0 || end < start || end > bytes.byteLength) {
      failVintageStory("MALFORMED_RESPONSE");
    }
    this.bytes = bytes;
    this.offset = start;
    this.limit = end;
  }

  public get done(): boolean {
    return this.offset === this.limit;
  }

  public readVarint(): number {
    const start = this.offset;
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 5; index += 1) {
      const byte = this.readByte();
      if (index === 4 && byte > 0x0f) {
        failVintageStory("MALFORMED_RESPONSE");
      }
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (this.offset - start !== varintSize(value)) {
          failVintageStory("MALFORMED_RESPONSE");
        }
        return value;
      }
      multiplier *= 128;
    }
    return failVintageStory("MALFORMED_RESPONSE");
  }

  public readKey(): Key {
    const key = this.readVarint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field < 1 || (wire !== 0 && wire !== 1 && wire !== 2 && wire !== 5)) {
      return failVintageStory("MALFORMED_RESPONSE");
    }
    return { field, wire };
  }

  public readBytes(maximum: number): Cursor {
    const length = this.readVarint();
    if (length > maximum || this.offset + length > this.limit) {
      return failVintageStory(length > maximum ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE");
    }
    const result = new Cursor(this.bytes, this.offset, this.offset + length);
    this.offset += length;
    return result;
  }

  public readString(maximum: number): string {
    const length = this.readVarint();
    if (length > maximum || this.offset + length > this.limit) {
      return failVintageStory(length > maximum ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE");
    }
    try {
      const result = new TextDecoder("utf-8", { fatal: true }).decode(
        this.bytes.subarray(this.offset, this.offset + length),
      );
      this.offset += length;
      return result;
    } catch {
      return failVintageStory("MALFORMED_RESPONSE");
    }
  }

  public skip(wire: number): void {
    if (wire === 0) {
      this.skipVarint();
      return;
    }
    if (wire === 1) {
      this.advance(8);
      return;
    }
    if (wire === 2) {
      const length = this.readVarint();
      this.advance(length);
      return;
    }
    if (wire === 5) {
      this.advance(4);
      return;
    }
    failVintageStory("MALFORMED_RESPONSE");
  }

  private readByte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined || this.offset >= this.limit) {
      return failVintageStory("MALFORMED_RESPONSE");
    }
    this.offset += 1;
    return value;
  }

  private skipVarint(): void {
    for (let index = 0; index < 10; index += 1) {
      const byte = this.readByte();
      if (index === 9 && byte > 1) {
        failVintageStory("MALFORMED_RESPONSE");
      }
      if ((byte & 0x80) === 0) {
        if (index > 0 && byte === 0) {
          failVintageStory("MALFORMED_RESPONSE");
        }
        return;
      }
    }
    failVintageStory("MALFORMED_RESPONSE");
  }

  private advance(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.limit) {
      failVintageStory("MALFORMED_RESPONSE");
    }
    this.offset += length;
  }
}

function varintSize(value: number): number {
  if (value < 0x80) return 1;
  if (value < 0x4000) return 2;
  if (value < 0x20_0000) return 3;
  if (value < 0x1000_0000) return 4;
  return 5;
}

function requireWire(actual: number, expected: number): void {
  if (actual !== expected) {
    failVintageStory("MALFORMED_RESPONSE");
  }
}

function unique(seen: Set<number>, field: number): void {
  if (seen.has(field)) {
    failVintageStory("MALFORMED_RESPONSE");
  }
  seen.add(field);
}

/** Encodes the official empty ServerQuery packet inside its big-endian TCP frame. */
export function encodeVintageStoryQueryRequest(): Uint8Array {
  return Uint8Array.of(0, 0, 0, 4, 0x08, 0x0f, 0x52, 0);
}

/** Inspects only the outer frame so fragmented TCP reads remain valid. */
export function inspectVintageStoryQueryResponse(data: Uint8Array): TcpResponseState {
  if (data.byteLength < FRAME_HEADER_BYTES) {
    return "incomplete";
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const declared = view.getUint32(0);
  if ((declared & 0x8000_0000) !== 0 || declared < 1) {
    return "malformed";
  }
  if (declared > VINTAGE_STORY_MAX_RESPONSE_BYTES - FRAME_HEADER_BYTES) {
    return "too-large";
  }
  const expected = FRAME_HEADER_BYTES + declared;
  if (data.byteLength < expected) {
    return "incomplete";
  }
  return data.byteLength === expected ? "complete" : "malformed";
}

function parseStatus(cursor: Cursor): VintageStoryQueryAnswer {
  const seen = new Set<number>();
  let name: string | undefined;
  let motd: string | undefined;
  let playersOnline: number | undefined;
  let playersMax: number | undefined;
  let gameMode: string | undefined;
  let password: boolean | undefined;
  let version: string | undefined;
  while (!cursor.done) {
    const key = cursor.readKey();
    if (key.field >= 1 && key.field <= 7) unique(seen, key.field);
    if (key.field === 1) {
      requireWire(key.wire, 2);
      name = cursor.readString(MAX_NAME_BYTES);
    } else if (key.field === 2) {
      requireWire(key.wire, 2);
      motd = cursor.readString(MAX_STRING_BYTES);
    } else if (key.field === 3) {
      requireWire(key.wire, 0);
      playersOnline = cursor.readVarint();
    } else if (key.field === 4) {
      requireWire(key.wire, 0);
      playersMax = cursor.readVarint();
    } else if (key.field === 5) {
      requireWire(key.wire, 2);
      gameMode = cursor.readString(MAX_GAME_MODE_BYTES);
    } else if (key.field === 6) {
      requireWire(key.wire, 0);
      const value = cursor.readVarint();
      if (value > 1) failVintageStory("MALFORMED_RESPONSE");
      password = value === 1;
    } else if (key.field === 7) {
      requireWire(key.wire, 2);
      version = cursor.readString(MAX_VERSION_BYTES);
    } else {
      cursor.skip(key.wire);
    }
  }
  if (playersOnline !== undefined && playersMax !== undefined && playersOnline > playersMax) {
    failVintageStory("MALFORMED_RESPONSE");
  }
  return Object.freeze({
    kind: "status",
    ...(name === undefined ? {} : { name }),
    ...(motd === undefined ? {} : { motd }),
    ...(playersOnline === undefined ? {} : { playersOnline }),
    ...(playersMax === undefined ? {} : { playersMax }),
    ...(gameMode === undefined ? {} : { gameMode }),
    ...(password === undefined ? {} : { password }),
    ...(version === undefined ? {} : { version }),
  });
}

function parseDisconnect(cursor: Cursor): VintageStoryQueryAnswer {
  let reason: string | undefined;
  const seen = new Set<number>();
  while (!cursor.done) {
    const key = cursor.readKey();
    if (key.field === 1) {
      unique(seen, key.field);
      requireWire(key.wire, 2);
      reason = cursor.readString(MAX_STRING_BYTES);
    } else {
      cursor.skip(key.wire);
    }
  }
  if (reason !== QUERY_COMPLETE) {
    failVintageStory("MALFORMED_RESPONSE");
  }
  return Object.freeze({ kind: "liveness" });
}

/** Parses an exact stock acknowledgement or compatible status answer frame. */
export function parseVintageStoryQueryResponse(data: Uint8Array): VintageStoryQueryAnswer {
  const framing = inspectVintageStoryQueryResponse(data);
  if (framing !== "complete") {
    return failVintageStory(framing === "too-large" ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE");
  }
  const outer = new Cursor(data, FRAME_HEADER_BYTES);
  let packetId: number | undefined;
  let answer: Cursor | undefined;
  let disconnect: Cursor | undefined;
  const seen = new Set<number>();
  while (!outer.done) {
    const key = outer.readKey();
    if (key.field === 90) {
      unique(seen, key.field);
      requireWire(key.wire, 0);
      packetId = outer.readVarint();
    } else if (key.field === 28) {
      unique(seen, key.field);
      requireWire(key.wire, 2);
      answer = outer.readBytes(VINTAGE_STORY_MAX_RESPONSE_BYTES);
    } else if (key.field === 8) {
      unique(seen, key.field);
      requireWire(key.wire, 2);
      disconnect = outer.readBytes(VINTAGE_STORY_MAX_RESPONSE_BYTES);
    } else {
      outer.skip(key.wire);
    }
  }
  if (packetId === QUERY_ANSWER_PACKET_ID && answer !== undefined && disconnect === undefined) {
    return parseStatus(answer);
  }
  if (packetId === DISCONNECT_PACKET_ID && disconnect !== undefined && answer === undefined) {
    return parseDisconnect(disconnect);
  }
  return failVintageStory("MALFORMED_RESPONSE");
}

/** Queries one pinned Vintage Story address without consulting the central server list. */
export async function queryVintageStory(
  options: VintageStoryQueryOptions,
  dependencies?: VintageStoryQueryDependencies,
): Promise<VintageStoryQueryResult> {
  const result = await tcpExchange(
    {
      scope: options.scope,
      target: options.target,
      address: options.address,
      request: encodeVintageStoryQueryRequest(),
      maxResponseBytes: VINTAGE_STORY_MAX_RESPONSE_BYTES,
      inspectResponse: inspectVintageStoryQueryResponse,
    },
    dependencies,
  );
  return Object.freeze({
    answer: parseVintageStoryQueryResponse(result.data),
    rttMs: result.rttMs,
  });
}
