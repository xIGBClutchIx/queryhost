/** QUIC v1 packet headers, coalesced-datagram splitting, and header/payload protection. */

import {
  AEAD_TAG_BYTES,
  HEADER_SAMPLE_BYTES,
  headerProtectionMask,
  openPayload,
  sealPayload,
  type PacketProtection,
} from "./crypto.js";
import { failQuic } from "./errors.js";
import { concatBytes, WireReader, WireWriter } from "./wire.js";

export const QUIC_VERSION_1 = 0x0000_0001;
export const MAX_CONNECTION_ID_BYTES = 20;
/** Locally sent packet numbers always use four bytes, which keeps the header sample in range. */
const SENT_PACKET_NUMBER_BYTES = 4;

export type PacketSpace = "initial" | "handshake" | "application";

type LongPacketType = "initial" | "zero-rtt" | "handshake" | "retry";
const LONG_PACKET_TYPES: readonly LongPacketType[] = ["initial", "zero-rtt", "handshake", "retry"];

/** A peer Version Negotiation packet; it is not authenticated and only ends the attempt. */
export interface VersionNegotiationPacket {
  readonly kind: "version-negotiation";
  readonly destination: Uint8Array;
  readonly source: Uint8Array;
  readonly versions: readonly number[];
}

/** A peer Retry packet whose integrity tag the connection verifies before use. */
export interface RetryPacket {
  readonly kind: "retry";
  readonly destination: Uint8Array;
  readonly source: Uint8Array;
  readonly token: Uint8Array;
  readonly tag: Uint8Array;
  readonly withoutTag: Uint8Array;
}

/** A protected packet whose boundaries are known but whose contents are still encrypted. */
export interface ProtectedPacket {
  readonly kind: "protected";
  readonly space: PacketSpace;
  readonly destination: Uint8Array;
  /** Present on long-header packets only. */
  readonly source?: Uint8Array;
  readonly bytes: Uint8Array;
  readonly packetNumberOffset: number;
}

export type IncomingPacket = VersionNegotiationPacket | RetryPacket | ProtectedPacket;

/** A decrypted packet's number and frame payload. */
export interface OpenedPacket {
  readonly packetNumber: number;
  readonly payload: Uint8Array;
}

function connectionId(reader: WireReader): Uint8Array {
  const id = reader.vector(1);
  return id.byteLength <= MAX_CONNECTION_ID_BYTES ? id : failQuic("MALFORMED_RESPONSE");
}

/**
 * Splits one datagram into its coalesced packets (RFC 9000 section 12.2). Parsing stops at the
 * first packet whose header is unreadable, because its length — and so the next packet's start —
 * is then unknown. Short-header packets always run to the end of the datagram.
 */
export function splitDatagram(datagram: Uint8Array, localIdLength: number): IncomingPacket[] {
  const packets: IncomingPacket[] = [];
  let offset = 0;
  while (offset < datagram.byteLength) {
    const first = datagram[offset] ?? 0;
    if ((first & 0x80) === 0) {
      const destinationEnd = offset + 1 + localIdLength;
      if ((first & 0x40) === 0 || destinationEnd > datagram.byteLength) {
        break;
      }
      packets.push({
        kind: "protected",
        space: "application",
        destination: datagram.subarray(offset + 1, destinationEnd),
        bytes: datagram.subarray(offset),
        packetNumberOffset: 1 + localIdLength,
      });
      break;
    }
    let packet: { readonly packet: IncomingPacket | undefined; readonly length: number };
    try {
      packet = readLongHeader(datagram, offset);
    } catch {
      break;
    }
    if (packet.packet !== undefined) {
      packets.push(packet.packet);
    }
    if (packet.length <= 0) {
      break;
    }
    offset += packet.length;
  }
  return packets;
}

/** Reads one long header and returns the packet plus how many datagram bytes it occupies. */
function readLongHeader(
  datagram: Uint8Array,
  start: number,
): { readonly packet: IncomingPacket | undefined; readonly length: number } {
  const reader = new WireReader(datagram.subarray(start));
  const first = reader.u8();
  const version = reader.u32();
  const destination = connectionId(reader);
  const source = connectionId(reader);
  // A length of zero ends splitting: none of these packets can be followed by one we can read.
  if (version === 0) {
    const versions: number[] = [];
    while (reader.remaining >= 4) {
      versions.push(reader.u32());
    }
    return { packet: { kind: "version-negotiation", destination, source, versions }, length: 0 };
  }
  if (version !== QUIC_VERSION_1) {
    return { packet: undefined, length: 0 };
  }
  if ((first & 0x40) === 0) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const type = LONG_PACKET_TYPES[(first >> 4) & 0x03] ?? failQuic("MALFORMED_RESPONSE");
  if (type === "retry") {
    const rest = reader.rest();
    if (rest.byteLength < AEAD_TAG_BYTES) {
      return failQuic("MALFORMED_RESPONSE");
    }
    const tokenEnd = rest.byteLength - AEAD_TAG_BYTES;
    return {
      packet: {
        kind: "retry",
        destination,
        source,
        token: rest.subarray(0, tokenEnd),
        tag: rest.subarray(tokenEnd),
        withoutTag: datagram.subarray(start, datagram.byteLength - AEAD_TAG_BYTES),
      },
      length: 0,
    };
  }
  if (type === "initial") {
    reader.bytes(reader.varint());
  }
  const payloadLength = reader.varint();
  const packetNumberOffset = reader.offset;
  const length = packetNumberOffset + payloadLength;
  if (length > datagram.byteLength - start) {
    return failQuic("MALFORMED_RESPONSE");
  }
  if (type === "zero-rtt") {
    // Servers never send 0-RTT; skip it without failing the rest of the datagram.
    return { packet: undefined, length };
  }
  return {
    packet: {
      kind: "protected",
      space: type,
      destination,
      source,
      bytes: datagram.subarray(start, start + length),
      packetNumberOffset,
    },
    length,
  };
}

/** Recovers a full packet number from its truncated encoding (RFC 9000 appendix A.3). */
export function decodePacketNumber(largest: number, truncated: number, bytes: number): number {
  const expected = largest + 1;
  const window = 2 ** (bytes * 8);
  const halfWindow = window / 2;
  const candidate = expected - (expected % window) + truncated;
  if (candidate <= expected - halfWindow && candidate < 2 ** 62 - window) {
    return candidate + window;
  }
  if (candidate > expected + halfWindow && candidate >= window) {
    return candidate - window;
  }
  return candidate;
}

/**
 * Removes header protection and decrypts one packet. Returns `undefined` for a packet that cannot
 * be authenticated, which QUIC requires endpoints to drop silently.
 */
export function openPacket(
  packet: ProtectedPacket,
  keys: PacketProtection,
  largestReceived: number,
): OpenedPacket | undefined {
  const bytes = packet.bytes;
  const sampleStart = packet.packetNumberOffset + 4;
  if (sampleStart + HEADER_SAMPLE_BYTES > bytes.byteLength) {
    return undefined;
  }
  const mask = headerProtectionMask(
    keys.hp,
    bytes.subarray(sampleStart, sampleStart + HEADER_SAMPLE_BYTES),
  );
  const long = ((bytes[0] ?? 0) & 0x80) !== 0;
  const first = (bytes[0] ?? 0) ^ ((mask[0] ?? 0) & (long ? 0x0f : 0x1f));
  const packetNumberBytes = (first & 0x03) + 1;
  const headerEnd = packet.packetNumberOffset + packetNumberBytes;
  const header = Uint8Array.from(bytes.subarray(0, headerEnd));
  header[0] = first;
  let truncated = 0;
  for (let index = 0; index < packetNumberBytes; index += 1) {
    const position = packet.packetNumberOffset + index;
    const value = (header[position] ?? 0) ^ (mask[index + 1] ?? 0);
    header[position] = value;
    truncated = truncated * 256 + value;
  }
  const packetNumber = decodePacketNumber(largestReceived, truncated, packetNumberBytes);
  const payload = openPayload(keys, packetNumber, header, bytes.subarray(headerEnd));
  if (payload === undefined) {
    return undefined;
  }
  // Reserved bits are covered by header protection, so they are only checked once authenticated.
  if ((first & (long ? 0x0c : 0x18)) !== 0) {
    return failQuic("MALFORMED_RESPONSE");
  }
  if (!long && (first & 0x04) !== 0) {
    // The peer started a key update this short exchange does not implement; drop the packet.
    return undefined;
  }
  return { packetNumber, payload };
}

function applyHeaderProtection(
  packet: Uint8Array,
  packetNumberOffset: number,
  keys: PacketProtection,
): Uint8Array {
  const sampleStart = packetNumberOffset + 4;
  const mask = headerProtectionMask(
    keys.hp,
    packet.subarray(sampleStart, sampleStart + HEADER_SAMPLE_BYTES),
  );
  const long = ((packet[0] ?? 0) & 0x80) !== 0;
  packet[0] = (packet[0] ?? 0) ^ ((mask[0] ?? 0) & (long ? 0x0f : 0x1f));
  for (let index = 0; index < SENT_PACKET_NUMBER_BYTES; index += 1) {
    const position = packetNumberOffset + index;
    packet[position] = (packet[position] ?? 0) ^ (mask[index + 1] ?? 0);
  }
  return packet;
}

/** Inputs for one locally sent Initial or Handshake packet. */
export interface OutgoingLongPacket {
  readonly type: "initial" | "handshake";
  readonly destination: Uint8Array;
  readonly source: Uint8Array;
  /** Retry token carried by Initial packets; empty when the server has not sent one. */
  readonly token?: Uint8Array;
  readonly packetNumber: number;
  readonly payload: Uint8Array;
  readonly keys: PacketProtection;
}

export function protectLongPacket(packet: OutgoingLongPacket): Uint8Array {
  const typeBits = packet.type === "initial" ? 0x00 : 0x20;
  const header = new WireWriter()
    .u8(0xc0 | typeBits | (SENT_PACKET_NUMBER_BYTES - 1))
    .u32(QUIC_VERSION_1)
    .vector(1, packet.destination)
    .vector(1, packet.source);
  if (packet.type === "initial") {
    const token = packet.token ?? new Uint8Array(0);
    header.varint(token.byteLength).bytes(token);
  }
  header.varint(SENT_PACKET_NUMBER_BYTES + packet.payload.byteLength + AEAD_TAG_BYTES);
  const packetNumberOffset = header.length;
  header.u32(packet.packetNumber % 2 ** 32);
  const headerBytes = header.finish();
  const sealed = sealPayload(packet.keys, packet.packetNumber, headerBytes, packet.payload);
  return applyHeaderProtection(concatBytes([headerBytes, sealed]), packetNumberOffset, packet.keys);
}

/** Inputs for one locally sent 1-RTT packet. */
export interface OutgoingShortPacket {
  readonly destination: Uint8Array;
  readonly packetNumber: number;
  readonly payload: Uint8Array;
  readonly keys: PacketProtection;
}

export function protectShortPacket(packet: OutgoingShortPacket): Uint8Array {
  const header = new WireWriter()
    .u8(0x40 | (SENT_PACKET_NUMBER_BYTES - 1))
    .bytes(packet.destination);
  const packetNumberOffset = header.length;
  header.u32(packet.packetNumber % 2 ** 32);
  const headerBytes = header.finish();
  const sealed = sealPayload(packet.keys, packet.packetNumber, headerBytes, packet.payload);
  return applyHeaderProtection(concatBytes([headerBytes, sealed]), packetNumberOffset, packet.keys);
}

/** Bytes a long-header packet adds around its payload, used to size Initial padding exactly. */
export function longPacketOverhead(
  packet: Omit<OutgoingLongPacket, "keys" | "packetNumber">,
): number {
  const token = packet.token ?? new Uint8Array(0);
  const tokenLength =
    packet.type === "initial" ? varintLength(token.byteLength) + token.byteLength : 0;
  const body = SENT_PACKET_NUMBER_BYTES + packet.payload.byteLength + AEAD_TAG_BYTES;
  return (
    1 +
    4 +
    1 +
    packet.destination.byteLength +
    1 +
    packet.source.byteLength +
    tokenLength +
    varintLength(body) +
    SENT_PACKET_NUMBER_BYTES +
    AEAD_TAG_BYTES
  );
}

function varintLength(value: number): number {
  return value < 0x40 ? 1 : value < 0x4000 ? 2 : value < 0x4000_0000 ? 4 : 8;
}
