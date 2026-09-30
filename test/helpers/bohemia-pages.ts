/** Encodes Bohemia server-browser metadata into escaped Rules pages for Arma 3 and DayZ tests. */

const encoder = new TextEncoder();

/** Little-endian byte writer for metadata payloads. */
export class MetadataWriter {
  private readonly bytes: number[] = [];

  public uint8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  public uint16(value: number): this {
    return this.uint8(value).uint8(value >> 8);
  }

  public uint32(value: number): this {
    return this.uint16(value & 0xffff).uint16(Math.floor(value / 0x1_0000));
  }

  public uint64(value: bigint): this {
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.uint8(Number((value >> shift) & 0xffn));
    }
    return this;
  }

  public string(value: string): this {
    const encoded = encoder.encode(value);
    this.uint8(encoded.length);
    for (const byte of encoded) {
      this.uint8(byte);
    }
    return this;
  }

  public build(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function escape(bytes: Uint8Array): number[] {
  const output: number[] = [];
  for (const byte of bytes) {
    if (byte === 0x01) {
      output.push(0x01, 0x01);
    } else if (byte === 0x00) {
      output.push(0x01, 0x02);
    } else if (byte === 0xff) {
      output.push(0x01, 0x03);
    } else {
      output.push(byte);
    }
  }
  return output;
}

/** Escapes metadata and splits it into Rules entries keyed by raw `[page, total]` bytes. */
export function metadataPages(
  metadata: Uint8Array,
  pageSize = 124,
): readonly (readonly [Uint8Array, Uint8Array])[] {
  const escaped = escape(metadata);
  const pages: Uint8Array[] = [];
  let offset = 0;
  while (offset < escaped.length) {
    const end = Math.min(offset + pageSize, escaped.length);
    pages.push(Uint8Array.from(escaped.slice(offset, end)));
    offset = end;
  }
  return pages.map((page, index) => [Uint8Array.of(index + 1, pages.length), page] as const);
}
