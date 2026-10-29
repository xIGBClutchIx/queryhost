/** QUIC v1 frame parsing and the few frame encodings a status client sends (RFC 9000 section 19). */

import { failQuic } from "./errors.js";
import type { PacketSpace } from "./packet.js";
import { WireReader, WireWriter } from "./wire.js";

/** Frames the connection acts on; every other valid frame is reduced to `other`. */
export type Frame =
  | { readonly type: "ack"; readonly ranges: readonly PacketRange[] }
  | { readonly type: "crypto"; readonly offset: number; readonly data: Uint8Array }
  | {
      readonly type: "stream";
      readonly streamId: number;
      readonly offset: number;
      readonly data: Uint8Array;
      readonly fin: boolean;
    }
  | { readonly type: "reset-stream"; readonly streamId: number }
  | { readonly type: "stop-sending"; readonly streamId: number }
  | { readonly type: "stream-data-blocked"; readonly streamId: number }
  | { readonly type: "data-blocked" }
  | { readonly type: "path-challenge"; readonly data: Uint8Array }
  | { readonly type: "connection-close" }
  | { readonly type: "handshake-done" }
  | { readonly type: "padding" }
  | { readonly type: "other" };

/** Inclusive packet-number range acknowledged by an ACK frame. */
export interface PacketRange {
  readonly smallest: number;
  readonly largest: number;
}

/** Frames whose receipt obliges the receiver to acknowledge the packet (RFC 9002 section 2). */
export function isAckEliciting(frame: Frame): boolean {
  return frame.type !== "ack" && frame.type !== "padding" && frame.type !== "connection-close";
}

/** Frame types allowed in Initial and Handshake packets (RFC 9000 section 12.4). */
const HANDSHAKE_SPACE_FRAMES = new Set([0x00, 0x01, 0x02, 0x03, 0x06, 0x1c]);
const MAX_ACK_RANGES = 256;

function ackRanges(reader: WireReader, withEcn: boolean): PacketRange[] {
  let largest = reader.varint();
  reader.varint(); // ACK delay: this client does not estimate RTT from peer acknowledgements.
  const rangeCount = reader.varint();
  if (rangeCount > MAX_ACK_RANGES) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const first = reader.varint();
  if (first > largest) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const ranges: PacketRange[] = [{ smallest: largest - first, largest }];
  let smallest = largest - first;
  for (let index = 0; index < rangeCount; index += 1) {
    const gap = reader.varint();
    const length = reader.varint();
    largest = smallest - gap - 2;
    smallest = largest - length;
    if (smallest < 0) {
      return failQuic("MALFORMED_RESPONSE");
    }
    ranges.push({ smallest, largest });
  }
  if (withEcn) {
    reader.varint();
    reader.varint();
    reader.varint();
  }
  return ranges;
}

function streamFrame(reader: WireReader, type: number): Frame {
  const streamId = reader.varint();
  const offset = (type & 0x04) === 0 ? 0 : reader.varint();
  const data = (type & 0x02) === 0 ? reader.rest() : reader.bytes(reader.varint());
  if (offset + data.byteLength > 2 ** 62 - 1) {
    return failQuic("MALFORMED_RESPONSE");
  }
  return { type: "stream", streamId, offset, data, fin: (type & 0x01) !== 0 };
}

function frame(reader: WireReader, type: number): Frame {
  if (type >= 0x08 && type <= 0x0f) {
    return streamFrame(reader, type);
  }
  switch (type) {
    case 0x00:
      return { type: "padding" };
    case 0x01:
      return { type: "other" };
    case 0x02:
    case 0x03:
      return { type: "ack", ranges: ackRanges(reader, type === 0x03) };
    case 0x04: {
      const streamId = reader.varint();
      reader.varint();
      reader.varint();
      return { type: "reset-stream", streamId };
    }
    case 0x05: {
      const streamId = reader.varint();
      reader.varint();
      return { type: "stop-sending", streamId };
    }
    case 0x06: {
      const offset = reader.varint();
      return { type: "crypto", offset, data: reader.bytes(reader.varint()) };
    }
    case 0x07:
      if (reader.bytes(reader.varint()).byteLength === 0) {
        return failQuic("MALFORMED_RESPONSE");
      }
      return { type: "other" };
    case 0x10:
    case 0x12:
    case 0x13:
    case 0x16:
    case 0x17:
    case 0x19:
      reader.varint();
      return { type: "other" };
    case 0x11:
      reader.varint();
      reader.varint();
      return { type: "other" };
    case 0x14:
      reader.varint();
      return { type: "data-blocked" };
    case 0x15: {
      const streamId = reader.varint();
      reader.varint();
      return { type: "stream-data-blocked", streamId };
    }
    case 0x18: {
      reader.varint();
      reader.varint();
      const length = reader.u8();
      if (length < 1 || length > 20) {
        return failQuic("MALFORMED_RESPONSE");
      }
      reader.bytes(length);
      reader.bytes(16);
      return { type: "other" };
    }
    case 0x1a:
      return { type: "path-challenge", data: reader.bytes(8) };
    case 0x1b:
      reader.bytes(8);
      return { type: "other" };
    case 0x1c:
    case 0x1d:
      reader.varint();
      if (type === 0x1c) {
        reader.varint();
      }
      reader.bytes(reader.varint());
      return { type: "connection-close" };
    case 0x1e:
      return { type: "handshake-done" };
    default:
      // Extension frames are only valid after negotiation, which this client never offers.
      return failQuic("MALFORMED_RESPONSE");
  }
}

/** Parses every frame in a decrypted payload, enforcing which frames each space may carry. */
export function parseFrames(payload: Uint8Array, space: PacketSpace): Frame[] {
  if (payload.byteLength === 0) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const reader = new WireReader(payload);
  const frames: Frame[] = [];
  while (reader.remaining > 0) {
    const type = reader.varint();
    if (space !== "application" && !HANDSHAKE_SPACE_FRAMES.has(type)) {
      return failQuic("MALFORMED_RESPONSE");
    }
    if (type === 0x00) {
      // Consecutive padding bytes collapse into one frame so a padded packet stays cheap to parse.
      while (reader.remaining > 0 && payload[reader.offset] === 0) {
        reader.u8();
      }
    }
    frames.push(frame(reader, type));
  }
  return frames;
}

/** ACK frame for received ranges, which must be sorted from largest to smallest and disjoint. */
export function encodeAck(ranges: readonly PacketRange[]): Uint8Array {
  const [first, ...rest] = ranges;
  if (first === undefined) {
    return failQuic("INVALID_INPUT");
  }
  const writer = new WireWriter()
    .varint(0x02)
    .varint(first.largest)
    .varint(0)
    .varint(rest.length)
    .varint(first.largest - first.smallest);
  let smallest = first.smallest;
  for (const range of rest) {
    writer.varint(smallest - range.largest - 2).varint(range.largest - range.smallest);
    smallest = range.smallest;
  }
  return writer.finish();
}

export function encodeCrypto(offset: number, data: Uint8Array): Uint8Array {
  return new WireWriter().varint(0x06).varint(offset).varint(data.byteLength).bytes(data).finish();
}

/** STREAM frame with explicit offset and length, so it may be followed by other frames. */
export function encodeStream(
  streamId: number,
  offset: number,
  data: Uint8Array,
  fin: boolean,
): Uint8Array {
  return new WireWriter()
    .varint(0x0e | (fin ? 0x01 : 0x00))
    .varint(streamId)
    .varint(offset)
    .varint(data.byteLength)
    .bytes(data)
    .finish();
}

export function encodePathResponse(data: Uint8Array): Uint8Array {
  return new WireWriter().varint(0x1b).bytes(data).finish();
}

export function encodePing(): Uint8Array {
  return Uint8Array.of(0x01);
}

/** Application CONNECTION_CLOSE with NO_ERROR, sent once the exchange is over. */
export function encodeApplicationClose(): Uint8Array {
  return new WireWriter().varint(0x1d).varint(0).varint(0).finish();
}

/** Transport CONNECTION_CLOSE carrying an error code, for handshake-space abandonment. */
export function encodeTransportClose(errorCode: number): Uint8Array {
  return new WireWriter().varint(0x1c).varint(errorCode).varint(0).varint(0).finish();
}
