/** Bounds-checked big-endian and QUIC variable-length integer encoding. */

import { failQuic } from "./errors.js";

/** Largest value a QUIC varint can carry that is still exact as a JavaScript number. */
const MAX_VARINT = Number.MAX_SAFE_INTEGER;

/**
 * Sequential reader over peer-controlled bytes. Every read is bounds-checked and reports
 * `MALFORMED_RESPONSE`, so a truncated or inconsistent structure never reads past its frame.
 */
export class WireReader {
  readonly #data: Uint8Array;
  #offset = 0;

  public constructor(data: Uint8Array) {
    this.#data = data;
  }

  public get offset(): number {
    return this.#offset;
  }

  public get remaining(): number {
    return this.#data.byteLength - this.#offset;
  }

  public u8(): number {
    return this.#take(1)[0] ?? failQuic("MALFORMED_RESPONSE");
  }

  public u16(): number {
    const bytes = this.#take(2);
    return ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  }

  public u24(): number {
    const bytes = this.#take(3);
    return ((bytes[0] ?? 0) << 16) | ((bytes[1] ?? 0) << 8) | (bytes[2] ?? 0);
  }

  public u32(): number {
    const bytes = this.#take(4);
    return (
      (((bytes[0] ?? 0) << 24) |
        ((bytes[1] ?? 0) << 16) |
        ((bytes[2] ?? 0) << 8) |
        (bytes[3] ?? 0)) >>>
      0
    );
  }

  /** Reads a QUIC varint (RFC 9000 section 16); values beyond 2^53 are rejected rather than rounded. */
  public varint(): number {
    return this.varintOrUnknown() ?? failQuic("MALFORMED_RESPONSE");
  }

  /**
   * Reads a varint, returning `undefined` for a well-formed value too large to be exact. Used for
   * identifiers where such values are reserved GREASE codepoints that must be skipped, not rejected.
   */
  public varintOrUnknown(): number | undefined {
    const first = this.u8();
    const length = 1 << (first >> 6);
    let value = first & 0x3f;
    for (const byte of this.#take(length - 1)) {
      value = value * 256 + byte;
    }
    return value <= MAX_VARINT ? value : undefined;
  }

  public bytes(length: number): Uint8Array {
    return this.#take(length);
  }

  /** Reads a vector whose length prefix is 1, 2, or 3 bytes wide. */
  public vector(prefixBytes: 1 | 2 | 3): Uint8Array {
    const length = prefixBytes === 1 ? this.u8() : prefixBytes === 2 ? this.u16() : this.u24();
    return this.#take(length);
  }

  public rest(): Uint8Array {
    return this.#take(this.remaining);
  }

  #take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      return failQuic("MALFORMED_RESPONSE");
    }
    const start = this.#offset;
    this.#offset += length;
    return this.#data.subarray(start, this.#offset);
  }
}

/** Append-only byte builder for locally generated packets and handshake messages. */
export class WireWriter {
  readonly #chunks: Uint8Array[] = [];
  #length = 0;

  public get length(): number {
    return this.#length;
  }

  public u8(value: number): this {
    return this.bytes(Uint8Array.of(value & 0xff));
  }

  public u16(value: number): this {
    return this.bytes(Uint8Array.of((value >> 8) & 0xff, value & 0xff));
  }

  public u24(value: number): this {
    return this.bytes(Uint8Array.of((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff));
  }

  public u32(value: number): this {
    return this.bytes(
      Uint8Array.of((value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff),
    );
  }

  public varint(value: number): this {
    return this.bytes(encodeVarint(value));
  }

  public bytes(value: Uint8Array): this {
    this.#chunks.push(value);
    this.#length += value.byteLength;
    return this;
  }

  /** Writes `value` behind a big-endian length prefix of the given width. */
  public vector(prefixBytes: 1 | 2 | 3, value: Uint8Array): this {
    const max = prefixBytes === 1 ? 0xff : prefixBytes === 2 ? 0xffff : 0xffffff;
    if (value.byteLength > max) {
      return failQuic("INVALID_INPUT");
    }
    if (prefixBytes === 1) {
      this.u8(value.byteLength);
    } else if (prefixBytes === 2) {
      this.u16(value.byteLength);
    } else {
      this.u24(value.byteLength);
    }
    return this.bytes(value);
  }

  public finish(): Uint8Array {
    return concatBytes(this.#chunks);
  }
}

/** Minimal-length QUIC varint encoding. */
export function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    return failQuic("INVALID_INPUT");
  }
  if (value < 0x40) {
    return Uint8Array.of(value);
  }
  if (value < 0x4000) {
    return Uint8Array.of(0x40 | (value >> 8), value & 0xff);
  }
  if (value < 0x4000_0000) {
    return Uint8Array.of(
      0x80 | (value >>> 24),
      (value >> 16) & 0xff,
      (value >> 8) & 0xff,
      value & 0xff,
    );
  }
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] = (bytes[0] ?? 0) | 0xc0;
  return bytes;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.byteLength;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
