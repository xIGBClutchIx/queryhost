/** Bounded Source and GoldSource split-packet inspection and reconstruction. */

import BZip2 from "@foxglove/wasm-bz2";

import { failA2s } from "./errors.js";

const SINGLE_PACKET_HEADER = -1;
const SPLIT_PACKET_HEADER = -2;
const SOURCE_COMPRESSED_FLAG = 0x8000_0000;
const SOURCE_OLD_HEADER_BYTES = 10;
const SOURCE_HEADER_BYTES = 12;
const GOLDSOURCE_HEADER_BYTES = 9;
const COMPRESSION_METADATA_BYTES = 8;
const BZIP2_MAGIC = Uint8Array.of(0x42, 0x5a, 0x68);

/** Maximum number of fragments accepted for one A2S response. */
export const A2S_MAX_FRAGMENTS = 15;
/** Maximum number of datagrams accepted so duplicate floods remain bounded. */
export const A2S_MAX_DATAGRAMS: number = A2S_MAX_FRAGMENTS * 2;
/** Maximum size of one A2S response datagram. */
export const A2S_MAX_DATAGRAM_BYTES = 1_400;
/** Maximum compressed bytes retained before bzip2 decoding. */
export const A2S_MAX_COMPRESSED_BYTES = 16_384;
/** Maximum reconstructed response size, including its single-packet header. */
export const A2S_MAX_RESPONSE_BYTES = 65_536;
/** Maximum aggregate datagram bytes retained during reconstruction. */
export const A2S_MAX_COLLECTION_BYTES: number = A2S_MAX_DATAGRAMS * A2S_MAX_DATAGRAM_BYTES;

type A2sSplitFormat = "goldsource" | "source";

interface A2sFragmentEnvelope {
  readonly format: A2sSplitFormat;
  readonly requestId: number;
  readonly count: number;
  readonly index: number;
  readonly compressed: boolean;
  readonly packet: Uint8Array;
}

/** Injectable decompression boundary for deterministic failure and bomb tests. */
export interface A2sSplitDependencies {
  decompress(compressed: Uint8Array, outputBytes: number): Promise<Uint8Array>;
}

let bzip2Promise: Promise<BZip2> | undefined;

async function getBzip2(): Promise<BZip2> {
  bzip2Promise ??= BZip2.init();
  return bzip2Promise;
}

const DEFAULT_DEPENDENCIES: A2sSplitDependencies = {
  async decompress(compressed: Uint8Array, outputBytes: number): Promise<Uint8Array> {
    const bzip2 = await getBzip2();
    return bzip2.decompress(compressed, outputBytes);
  },
};

function readInt32(packet: Uint8Array, offset: number): number {
  return new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getInt32(offset, true);
}

function readUint16(packet: Uint8Array, offset: number): number {
  return new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint16(offset, true);
}

function readUint32(packet: Uint8Array, offset: number): number {
  return new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(offset, true);
}

function startsWith(packet: Uint8Array, offset: number, prefix: Uint8Array): boolean {
  if (packet.byteLength - offset < prefix.byteLength) {
    return false;
  }
  return prefix.every((value, index) => packet[offset + index] === value);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)
  );
}

function parseEnvelope(packet: Uint8Array): A2sFragmentEnvelope | undefined {
  if (packet.byteLength < 4 || packet.byteLength > A2S_MAX_DATAGRAM_BYTES) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const header = readInt32(packet, 0);
  if (header === SINGLE_PACKET_HEADER) {
    return undefined;
  }
  if (header !== SPLIT_PACKET_HEADER || packet.byteLength < GOLDSOURCE_HEADER_BYTES + 1) {
    return failA2s("MALFORMED_RESPONSE");
  }

  const requestId = readUint32(packet, 4);
  const sourceCount = packet[8];
  const sourceIndex = packet[9];
  if (
    sourceCount !== undefined &&
    sourceIndex !== undefined &&
    sourceCount >= 2 &&
    sourceCount <= A2S_MAX_FRAGMENTS &&
    sourceIndex < sourceCount
  ) {
    return {
      format: "source",
      requestId,
      count: sourceCount,
      index: sourceIndex,
      compressed: (requestId & SOURCE_COMPRESSED_FLAG) !== 0,
      packet,
    };
  }

  const packed = packet[8];
  if (packed === undefined) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const count = packed & 0x0f;
  const index = packed >>> 4;
  if (count < 2 || count > A2S_MAX_FRAGMENTS || index >= count) {
    return failA2s("MALFORMED_RESPONSE");
  }
  return { format: "goldsource", requestId, count, index, compressed: false, packet };
}

function collectEnvelopes(datagrams: readonly Uint8Array[]): readonly A2sFragmentEnvelope[] {
  if (datagrams.length === 0 || datagrams.length > A2S_MAX_DATAGRAMS) {
    return failA2s("FRAGMENT_LIMIT");
  }
  const firstDatagram = datagrams[0];
  if (firstDatagram === undefined) {
    return failA2s("FRAGMENT_LIMIT");
  }
  const first = parseEnvelope(firstDatagram);
  if (first === undefined) {
    if (datagrams.length !== 1) {
      return failA2s("FRAGMENT_CONFLICT");
    }
    return [];
  }

  const byIndex = new Map<number, A2sFragmentEnvelope>();
  for (const datagram of datagrams) {
    const envelope = parseEnvelope(datagram);
    if (envelope === undefined) {
      return failA2s("FRAGMENT_CONFLICT");
    }
    if (
      envelope.format !== first.format ||
      envelope.requestId !== first.requestId ||
      envelope.count !== first.count ||
      envelope.compressed !== first.compressed
    ) {
      return failA2s("FRAGMENT_CONFLICT");
    }
    const existing = byIndex.get(envelope.index);
    if (existing !== undefined && !bytesEqual(existing.packet, envelope.packet)) {
      return failA2s("FRAGMENT_CONFLICT");
    }
    byIndex.set(envelope.index, envelope);
  }
  return [...byIndex.values()].sort((left, right) => left.index - right.index);
}

/** Returns whether the received datagrams contain one complete A2S response. */
export function isA2sResponseComplete(datagrams: readonly Uint8Array[]): boolean {
  const envelopes = collectEnvelopes(datagrams);
  if (envelopes.length === 0) {
    return true;
  }
  const first = envelopes[0];
  return envelopes.length === first?.count;
}

function concatenate(parts: readonly Uint8Array[], maximumBytes: number): Uint8Array {
  const totalBytes = parts.reduce((total, part) => total + part.byteLength, 0);
  if (totalBytes > maximumBytes) {
    return failA2s("RESPONSE_TOO_LARGE");
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function sourceHeaderBytes(first: A2sFragmentEnvelope): number {
  const packet = first.packet;
  if (first.compressed) {
    if (startsWith(packet, SOURCE_OLD_HEADER_BYTES + COMPRESSION_METADATA_BYTES, BZIP2_MAGIC)) {
      return SOURCE_OLD_HEADER_BYTES;
    }
    if (startsWith(packet, SOURCE_HEADER_BYTES + COMPRESSION_METADATA_BYTES, BZIP2_MAGIC)) {
      return SOURCE_HEADER_BYTES;
    }
    return failA2s("DECOMPRESSION_FAILED");
  }
  const singleHeader = Uint8Array.of(0xff, 0xff, 0xff, 0xff);
  if (startsWith(packet, SOURCE_OLD_HEADER_BYTES, singleHeader)) {
    return SOURCE_OLD_HEADER_BYTES;
  }
  if (startsWith(packet, SOURCE_HEADER_BYTES, singleHeader)) {
    return SOURCE_HEADER_BYTES;
  }
  return failA2s("MALFORMED_RESPONSE");
}

function validateSourceHeaders(
  envelopes: readonly A2sFragmentEnvelope[],
  headerBytes: number,
): void {
  let advertisedSize: number | undefined;
  for (const envelope of envelopes) {
    if (envelope.packet.byteLength <= headerBytes) {
      failA2s("MALFORMED_RESPONSE");
    }
    if (headerBytes === SOURCE_HEADER_BYTES) {
      const size = readUint16(envelope.packet, SOURCE_OLD_HEADER_BYTES);
      if (size < 1 || size > A2S_MAX_DATAGRAM_BYTES) {
        failA2s("MALFORMED_RESPONSE");
      }
      advertisedSize ??= size;
      if (size !== advertisedSize) {
        failA2s("FRAGMENT_CONFLICT");
      }
    }
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb8_8320);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function reconstructSource(
  envelopes: readonly A2sFragmentEnvelope[],
  dependencies: A2sSplitDependencies,
): Promise<Uint8Array> {
  const first = envelopes[0];
  if (first === undefined) {
    return failA2s("MALFORMED_RESPONSE");
  }
  if (first.index !== 0) {
    return failA2s("MALFORMED_RESPONSE");
  }
  const headerBytes = sourceHeaderBytes(first);
  validateSourceHeaders(envelopes, headerBytes);

  const payloads = envelopes.map((envelope): Uint8Array => {
    const metadataBytes =
      envelope.compressed && envelope.index === 0 ? COMPRESSION_METADATA_BYTES : 0;
    return envelope.packet.subarray(headerBytes + metadataBytes);
  });
  if (!first.compressed) {
    return concatenate(payloads, A2S_MAX_RESPONSE_BYTES);
  }

  const decompressedBytes = readUint32(first.packet, headerBytes);
  const expectedChecksum = readUint32(first.packet, headerBytes + 4);
  if (decompressedBytes < 5 || decompressedBytes > A2S_MAX_RESPONSE_BYTES) {
    return failA2s("RESPONSE_TOO_LARGE");
  }
  const compressed = concatenate(payloads, A2S_MAX_COMPRESSED_BYTES);
  let result: Uint8Array;
  try {
    result = await dependencies.decompress(compressed, decompressedBytes);
  } catch {
    return failA2s("DECOMPRESSION_FAILED");
  }
  if (result.byteLength !== decompressedBytes) {
    return failA2s("DECOMPRESSION_FAILED");
  }
  if (crc32(result) !== expectedChecksum) {
    return failA2s("CHECKSUM_MISMATCH");
  }
  return result;
}

/** Reconstructs one complete single- or split-packet A2S response. */
export async function reconstructA2sResponse(
  datagrams: readonly Uint8Array[],
  dependencies: A2sSplitDependencies = DEFAULT_DEPENDENCIES,
): Promise<Uint8Array> {
  const envelopes = collectEnvelopes(datagrams);
  if (envelopes.length === 0) {
    const datagram = datagrams[0];
    return datagram === undefined ? failA2s("FRAGMENT_LIMIT") : Uint8Array.from(datagram);
  }
  const first = envelopes[0];
  if (first === undefined) {
    return failA2s("MALFORMED_RESPONSE");
  }
  if (envelopes.length !== first.count) {
    return failA2s("MISSING_FRAGMENT");
  }
  if (first.format === "source") {
    return reconstructSource(envelopes, dependencies);
  }
  const payloads = envelopes.map((envelope) => envelope.packet.subarray(GOLDSOURCE_HEADER_BYTES));
  return concatenate(payloads, A2S_MAX_RESPONSE_BYTES);
}
