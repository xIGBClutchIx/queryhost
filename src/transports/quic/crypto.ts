/**
 * QUIC v1 packet protection (RFC 9001) and the TLS 1.3 HKDF primitives it is built on.
 *
 * Only TLS_AES_128_GCM_SHA256 is implemented: it is mandatory for every TLS 1.3 server, it is the
 * suite that protects QUIC Initial packets anyway, and one suite keeps the key schedule fixed.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";

import { concatBytes, WireWriter } from "./wire.js";

const HASH_BYTES = 32;
const KEY_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SAMPLE_BYTES = 16;

/** RFC 9001 section 5.2 salt for QUIC version 1 Initial secrets. */
const INITIAL_SALT = Buffer.from("38762cf7f55934b34d179ae6a4c80cadccbb7f0a", "hex");
/** RFC 9001 section 5.8 fixed Retry integrity key and nonce for QUIC version 1. */
const RETRY_KEY = Buffer.from("be0c690b9f66575a1d766b54e368c84e", "hex");
const RETRY_NONCE = Buffer.from("461599d35d632bf2239825bb", "hex");

export const AEAD_TAG_BYTES: number = TAG_BYTES;
export const HEADER_SAMPLE_BYTES: number = SAMPLE_BYTES;

/** Keys protecting one direction of one packet-number space. */
export interface PacketProtection {
  readonly key: Uint8Array;
  readonly iv: Uint8Array;
  readonly hp: Uint8Array;
}

export function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return new Uint8Array(hash.digest());
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(data).digest());
}

export function hkdfExtract(salt: Uint8Array, inputKeyMaterial: Uint8Array): Uint8Array {
  return hmacSha256(salt, inputKeyMaterial);
}

function hkdfExpand(pseudorandomKey: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  let produced = 0;
  for (let counter = 1; produced < length; counter += 1) {
    previous = hmacSha256(pseudorandomKey, concatBytes([previous, info, Uint8Array.of(counter)]));
    blocks.push(previous);
    produced += previous.byteLength;
  }
  return concatBytes(blocks).subarray(0, length);
}

/** HKDF-Expand-Label from RFC 8446 section 7.1. */
export function hkdfExpandLabel(
  secret: Uint8Array,
  label: string,
  context: Uint8Array,
  length: number,
): Uint8Array {
  const info = new WireWriter()
    .u16(length)
    .vector(1, new TextEncoder().encode(`tls13 ${label}`))
    .vector(1, context)
    .finish();
  return hkdfExpand(secret, info, length);
}

/** Derive-Secret from RFC 8446 section 7.1, taking an already computed transcript hash. */
export function deriveSecret(
  secret: Uint8Array,
  label: string,
  transcriptHash: Uint8Array,
): Uint8Array {
  return hkdfExpandLabel(secret, label, transcriptHash, HASH_BYTES);
}

export function packetProtection(secret: Uint8Array): PacketProtection {
  return Object.freeze({
    key: hkdfExpandLabel(secret, "quic key", new Uint8Array(0), KEY_BYTES),
    iv: hkdfExpandLabel(secret, "quic iv", new Uint8Array(0), IV_BYTES),
    hp: hkdfExpandLabel(secret, "quic hp", new Uint8Array(0), KEY_BYTES),
  });
}

/** Initial keys derived from the client's first Destination Connection ID. */
export function initialProtection(destinationConnectionId: Uint8Array): {
  readonly client: PacketProtection;
  readonly server: PacketProtection;
} {
  const initialSecret = hkdfExtract(INITIAL_SALT, destinationConnectionId);
  return {
    client: packetProtection(
      hkdfExpandLabel(initialSecret, "client in", new Uint8Array(0), HASH_BYTES),
    ),
    server: packetProtection(
      hkdfExpandLabel(initialSecret, "server in", new Uint8Array(0), HASH_BYTES),
    ),
  };
}

function nonce(iv: Uint8Array, packetNumber: number): Uint8Array {
  const result = Uint8Array.from(iv);
  let remaining = packetNumber;
  for (let index = result.byteLength - 1; index >= result.byteLength - 8; index -= 1) {
    result[index] = (result[index] ?? 0) ^ (remaining % 256);
    remaining = Math.floor(remaining / 256);
  }
  return result;
}

export function sealPayload(
  keys: PacketProtection,
  packetNumber: number,
  header: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  const cipher = createCipheriv("aes-128-gcm", keys.key, nonce(keys.iv, packetNumber));
  cipher.setAAD(header);
  return concatBytes([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** Returns `undefined` when authentication fails, which callers treat as an undecryptable packet. */
export function openPayload(
  keys: PacketProtection,
  packetNumber: number,
  header: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array | undefined {
  if (ciphertext.byteLength < TAG_BYTES) {
    return undefined;
  }
  try {
    const decipher = createDecipheriv("aes-128-gcm", keys.key, nonce(keys.iv, packetNumber));
    decipher.setAAD(header);
    decipher.setAuthTag(ciphertext.subarray(ciphertext.byteLength - TAG_BYTES));
    return concatBytes([
      decipher.update(ciphertext.subarray(0, ciphertext.byteLength - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    return undefined;
  }
}

/** AES-ECB header-protection mask over one 16-byte ciphertext sample (RFC 9001 section 5.4.3). */
export function headerProtectionMask(hp: Uint8Array, sample: Uint8Array): Uint8Array {
  const cipher = createCipheriv("aes-128-ecb", hp, null);
  cipher.setAutoPadding(false);
  return concatBytes([cipher.update(sample), cipher.final()]).subarray(0, 5);
}

/** Integrity tag over a Retry pseudo-packet (RFC 9001 section 5.8). */
export function retryIntegrityTag(
  originalDestinationConnectionId: Uint8Array,
  retryWithoutTag: Uint8Array,
): Uint8Array {
  const cipher = createCipheriv("aes-128-gcm", RETRY_KEY, RETRY_NONCE);
  cipher.setAAD(
    new WireWriter().vector(1, originalDestinationConnectionId).bytes(retryWithoutTag).finish(),
  );
  cipher.final();
  return new Uint8Array(cipher.getAuthTag());
}
