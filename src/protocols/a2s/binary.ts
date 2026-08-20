/** Bounds-checked little-endian primitives for A2S packet parsers. */

import { failA2s } from "./errors.js";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Stateful reader that either consumes a concrete value or fails without advancing past input. */
export class A2sBinaryReader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  public constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Bytes not yet consumed by the parser. */
  public get remaining(): number {
    return this.#bytes.byteLength - this.#offset;
  }

  /** Reads one unsigned byte. */
  public readUint8(): number {
    this.#require(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  /** Reads one unsigned little-endian 16-bit integer. */
  public readUint16(): number {
    this.#require(2);
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  /** Reads one signed little-endian 32-bit integer. */
  public readInt32(): number {
    this.#require(4);
    const value = this.#view.getInt32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  /** Reads one unsigned little-endian 32-bit integer. */
  public readUint32(): number {
    this.#require(4);
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  /** Reads one unsigned little-endian 64-bit integer without losing precision. */
  public readUint64(): bigint {
    this.#require(8);
    const value = this.#view.getBigUint64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  /** Reads one valid UTF-8, null-terminated string. */
  public readString(): string {
    const terminator = this.#bytes.indexOf(0, this.#offset);
    if (terminator === -1) {
      return failA2s("MALFORMED_RESPONSE");
    }

    const encoded = this.#bytes.subarray(this.#offset, terminator);
    this.#offset = terminator + 1;
    try {
      return UTF8_DECODER.decode(encoded);
    } catch {
      return failA2s("MALFORMED_RESPONSE");
    }
  }

  /** Requires that the packet contain no trailing bytes. */
  public expectEnd(): void {
    if (this.remaining !== 0) {
      failA2s("MALFORMED_RESPONSE");
    }
  }

  #require(length: number): void {
    if (this.remaining < length) {
      failA2s("MALFORMED_RESPONSE");
    }
  }
}
