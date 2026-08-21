/** Strict signed 32-bit VarInt primitives used by Minecraft packet framing. */

import { failMinecraftJava } from "./errors.js";

const MAX_VARINT_BYTES = 5;
const MIN_INT32 = -2_147_483_648;
const MAX_INT32 = 2_147_483_647;

/** Incomplete or complete incremental VarInt read. */
export type VarIntReadResult =
  | { readonly kind: "incomplete" }
  | { readonly kind: "value"; readonly value: number; readonly nextOffset: number };

/** Encodes one canonical signed 32-bit Minecraft VarInt. */
export function encodeVarInt(input: number): Uint8Array {
  if (!Number.isInteger(input) || input < MIN_INT32 || input > MAX_INT32) {
    return failMinecraftJava("INVALID_INPUT");
  }
  let value = input >>> 0;
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0);
  return Uint8Array.from(bytes);
}

/** Reads one canonical VarInt without treating fragmented input as malformed. */
export function readVarInt(data: Uint8Array, offset = 0): VarIntReadResult {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.byteLength) {
    return failMinecraftJava("INVALID_INPUT");
  }

  let result = 0;
  for (let index = 0; index < MAX_VARINT_BYTES; index += 1) {
    const byte = data[offset + index];
    if (byte === undefined) {
      return { kind: "incomplete" };
    }
    if (index === MAX_VARINT_BYTES - 1 && (byte & 0xf0) !== 0) {
      return failMinecraftJava("MALFORMED_RESPONSE");
    }
    result |= (byte & 0x7f) << (index * 7);
    if ((byte & 0x80) === 0) {
      const value = result | 0;
      if (encodeVarInt(value).byteLength !== index + 1) {
        return failMinecraftJava("MALFORMED_RESPONSE");
      }
      return { kind: "value", value, nextOffset: offset + index + 1 };
    }
  }
  return failMinecraftJava("MALFORMED_RESPONSE");
}
