/**
 * The TLS 1.3 client handshake QUIC carries in CRYPTO frames (RFC 8446 and RFC 9001).
 *
 * The client offers exactly one cipher suite (TLS_AES_128_GCM_SHA256) and one key-exchange group
 * (X25519), so a conforming server can neither negotiate something unimplemented nor need a
 * HelloRetryRequest. It never offers session resumption, early data, or client certificates.
 */

import {
  constants,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  verify,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import { isIP } from "node:net";

import { deriveSecret, hkdfExpandLabel, hkdfExtract, hmacSha256, sha256 } from "./crypto.js";
import { failQuic } from "./errors.js";
import { bytesEqual, concatBytes, WireReader, WireWriter } from "./wire.js";

const TLS_1_2 = 0x0303;
const TLS_1_3 = 0x0304;
const TLS_AES_128_GCM_SHA256 = 0x1301;
const X25519 = 0x001d;
const X25519_KEY_BYTES = 32;
const HASH_BYTES = 32;

const EXTENSION_SERVER_NAME = 0;
const EXTENSION_SUPPORTED_GROUPS = 10;
const EXTENSION_SIGNATURE_ALGORITHMS = 13;
const EXTENSION_ALPN = 16;
const EXTENSION_SUPPORTED_VERSIONS = 43;
const EXTENSION_KEY_SHARE = 51;
const EXTENSION_QUIC_TRANSPORT_PARAMETERS = 57;

const MESSAGE_CLIENT_HELLO = 1;
const MESSAGE_SERVER_HELLO = 2;
const MESSAGE_NEW_SESSION_TICKET = 4;
const MESSAGE_ENCRYPTED_EXTENSIONS = 8;
const MESSAGE_CERTIFICATE = 11;
const MESSAGE_CERTIFICATE_REQUEST = 13;
const MESSAGE_CERTIFICATE_VERIFY = 15;
const MESSAGE_FINISHED = 20;

/** Largest handshake message accepted; certificate chains are the only large messages. */
export const MAX_HANDSHAKE_MESSAGE_BYTES = 32_768;
const MAX_CERTIFICATES = 8;

/** SHA-256 of the HelloRetryRequest random value (RFC 8446 section 4.1.3). */
const HELLO_RETRY_REQUEST_RANDOM = Buffer.from(
  "cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c",
  "hex",
);
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const CERTIFICATE_VERIFY_CONTEXT = concatBytes([
  new Uint8Array(64).fill(0x20),
  new TextEncoder().encode("TLS 1.3, server CertificateVerify"),
  Uint8Array.of(0),
]);

interface SignatureScheme {
  readonly hash: "sha256" | "sha384" | "sha512" | null;
  readonly kind: "ecdsa" | "rsa-pss" | "ed25519";
  readonly curve?: string;
  readonly saltLength?: number;
}

/** Schemes Node can verify without extra code, in the client's preference order. */
const SIGNATURE_SCHEMES: ReadonlyMap<number, SignatureScheme> = new Map([
  [0x0403, { hash: "sha256", kind: "ecdsa", curve: "prime256v1" }],
  [0x0804, { hash: "sha256", kind: "rsa-pss", saltLength: 32 }],
  [0x0807, { hash: null, kind: "ed25519" }],
  [0x0503, { hash: "sha384", kind: "ecdsa", curve: "secp384r1" }],
  [0x0805, { hash: "sha384", kind: "rsa-pss", saltLength: 48 }],
  [0x0806, { hash: "sha512", kind: "rsa-pss", saltLength: 64 }],
]);

/** Ephemeral X25519 key pair for one handshake. */
export interface KeyShare {
  readonly publicKey: Uint8Array;
  readonly sharedSecret: (peerPublicKey: Uint8Array) => Uint8Array;
}

/** Builds an X25519 key share from 32 private-key bytes, so tests can inject deterministic keys. */
export function x25519KeyShare(privateKeyBytes: Uint8Array): KeyShare {
  if (privateKeyBytes.byteLength !== X25519_KEY_BYTES) {
    return failQuic("INVALID_INPUT");
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, privateKeyBytes]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return {
    publicKey: new Uint8Array(spki.subarray(spki.byteLength - X25519_KEY_BYTES)),
    sharedSecret(peerPublicKey: Uint8Array): Uint8Array {
      if (peerPublicKey.byteLength !== X25519_KEY_BYTES) {
        return failQuic("MALFORMED_RESPONSE");
      }
      let secret: Buffer;
      try {
        secret = diffieHellman({
          privateKey,
          publicKey: createPublicKey({
            key: Buffer.concat([X25519_SPKI_PREFIX, peerPublicKey]),
            format: "der",
            type: "spki",
          }),
        });
      } catch {
        return failQuic("MALFORMED_RESPONSE");
      }
      // RFC 8446 section 7.4.2: an all-zero X25519 output means the peer sent a low-order point.
      return secret.every((byte) => byte === 0)
        ? failQuic("MALFORMED_RESPONSE")
        : new Uint8Array(secret);
    },
  };
}

/** Inputs for the one ClientHello a connection sends. */
export interface ClientHelloOptions {
  readonly random: Uint8Array;
  readonly keyShare: KeyShare;
  /** DNS name for SNI; IP literals and `undefined` omit the extension (RFC 6066 section 3). */
  readonly serverName: string | undefined;
  readonly alpn: readonly string[];
  readonly transportParameters: Uint8Array;
}

function extension(writer: WireWriter, type: number, body: Uint8Array): void {
  writer.u16(type).vector(2, body);
}

/** Encodes the complete ClientHello handshake message, header included. */
export function encodeClientHello(options: ClientHelloOptions): Uint8Array {
  const extensions = new WireWriter();
  if (options.serverName !== undefined && isIP(options.serverName) === 0) {
    const name = new TextEncoder().encode(options.serverName);
    extension(
      extensions,
      EXTENSION_SERVER_NAME,
      new WireWriter().vector(2, new WireWriter().u8(0).vector(2, name).finish()).finish(),
    );
  }
  extension(
    extensions,
    EXTENSION_SUPPORTED_GROUPS,
    new WireWriter().vector(2, new WireWriter().u16(X25519).finish()).finish(),
  );
  const schemes = new WireWriter();
  for (const scheme of SIGNATURE_SCHEMES.keys()) {
    schemes.u16(scheme);
  }
  extension(
    extensions,
    EXTENSION_SIGNATURE_ALGORITHMS,
    new WireWriter().vector(2, schemes.finish()).finish(),
  );
  if (options.alpn.length > 0) {
    const protocols = new WireWriter();
    for (const protocol of options.alpn) {
      protocols.vector(1, new TextEncoder().encode(protocol));
    }
    extension(extensions, EXTENSION_ALPN, new WireWriter().vector(2, protocols.finish()).finish());
  }
  extension(
    extensions,
    EXTENSION_SUPPORTED_VERSIONS,
    new WireWriter().vector(1, new WireWriter().u16(TLS_1_3).finish()).finish(),
  );
  extension(
    extensions,
    EXTENSION_KEY_SHARE,
    new WireWriter()
      .vector(2, new WireWriter().u16(X25519).vector(2, options.keyShare.publicKey).finish())
      .finish(),
  );
  extension(extensions, EXTENSION_QUIC_TRANSPORT_PARAMETERS, options.transportParameters);

  const body = new WireWriter()
    .u16(TLS_1_2)
    .bytes(options.random)
    // QUIC forbids TLS middlebox compatibility mode, so the legacy session ID stays empty.
    .vector(1, new Uint8Array(0))
    .vector(2, new WireWriter().u16(TLS_AES_128_GCM_SHA256).finish())
    .vector(1, Uint8Array.of(0))
    .vector(2, extensions.finish())
    .finish();
  return new WireWriter().u8(MESSAGE_CLIENT_HELLO).vector(3, body).finish();
}

/** One complete handshake message, with its four-byte header retained for the transcript. */
export interface HandshakeMessage {
  readonly type: number;
  readonly body: Uint8Array;
  readonly bytes: Uint8Array;
}

/**
 * Splits the contiguous bytes of one CRYPTO stream into whole handshake messages. Returns the
 * messages and how many bytes they consumed; a trailing partial message waits for more data.
 */
export function readHandshakeMessages(data: Uint8Array): {
  readonly messages: readonly HandshakeMessage[];
  readonly consumed: number;
} {
  const messages: HandshakeMessage[] = [];
  let offset = 0;
  while (data.byteLength - offset >= 4) {
    const length =
      ((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0);
    if (length > MAX_HANDSHAKE_MESSAGE_BYTES) {
      return failQuic("MALFORMED_RESPONSE");
    }
    if (data.byteLength - offset - 4 < length) {
      break;
    }
    const bytes = data.subarray(offset, offset + 4 + length);
    messages.push({ type: data[offset] ?? 0, body: bytes.subarray(4), bytes });
    offset += 4 + length;
  }
  return { messages, consumed: offset };
}

function extensions(reader: WireReader): Map<number, Uint8Array> {
  const result = new Map<number, Uint8Array>();
  const list = new WireReader(reader.vector(2));
  while (list.remaining > 0) {
    const type = list.u16();
    const body = list.vector(2);
    if (result.has(type)) {
      return failQuic("MALFORMED_RESPONSE");
    }
    result.set(type, body);
  }
  return result;
}

function expectEnd(reader: WireReader): void {
  if (reader.remaining !== 0) {
    failQuic("MALFORMED_RESPONSE");
  }
}

/**
 * Validates a ServerHello and returns the server's X25519 share. A HelloRetryRequest cannot be
 * satisfied because the client already offered its only group, so it fails the attempt.
 */
export function parseServerHello(body: Uint8Array): Uint8Array {
  const reader = new WireReader(body);
  if (reader.u16() !== TLS_1_2) {
    return failQuic("MALFORMED_RESPONSE");
  }
  if (bytesEqual(reader.bytes(32), HELLO_RETRY_REQUEST_RANDOM)) {
    return failQuic("CONNECTION_FAILED");
  }
  if (
    reader.vector(1).byteLength !== 0 ||
    reader.u16() !== TLS_AES_128_GCM_SHA256 ||
    reader.u8() !== 0
  ) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const fields = extensions(reader);
  expectEnd(reader);
  const version = fields.get(EXTENSION_SUPPORTED_VERSIONS);
  const share = fields.get(EXTENSION_KEY_SHARE);
  // Only the two extensions a TLS 1.3 ServerHello must carry were solicited (RFC 8446 4.2).
  if (version === undefined || share === undefined || fields.size !== 2) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const versionReader = new WireReader(version);
  if (versionReader.u16() !== TLS_1_3) {
    return failQuic("MALFORMED_RESPONSE");
  }
  expectEnd(versionReader);
  const shareReader = new WireReader(share);
  if (shareReader.u16() !== X25519) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const publicKey = shareReader.vector(2);
  expectEnd(shareReader);
  return publicKey.byteLength === X25519_KEY_BYTES ? publicKey : failQuic("MALFORMED_RESPONSE");
}

/** Facts from EncryptedExtensions that the connection must validate. */
export interface EncryptedExtensions {
  readonly transportParameters: Uint8Array;
  readonly alpn?: string;
}

export function parseEncryptedExtensions(
  body: Uint8Array,
  offeredAlpn: readonly string[],
): EncryptedExtensions {
  const reader = new WireReader(body);
  const fields = extensions(reader);
  expectEnd(reader);
  let alpn: string | undefined;
  for (const [type, value] of fields) {
    if (type === EXTENSION_SERVER_NAME || type === EXTENSION_SUPPORTED_GROUPS) {
      continue;
    }
    if (type === EXTENSION_ALPN) {
      const list = new WireReader(value);
      const protocols = new WireReader(list.vector(2));
      expectEnd(list);
      alpn = new TextDecoder().decode(protocols.vector(1));
      expectEnd(protocols);
      if (!offeredAlpn.includes(alpn)) {
        return failQuic("CONNECTION_FAILED");
      }
      continue;
    }
    if (type !== EXTENSION_QUIC_TRANSPORT_PARAMETERS) {
      // A conforming server answers only extensions the client sent (RFC 8446 section 4.2).
      return failQuic("MALFORMED_RESPONSE");
    }
  }
  const transportParameters = fields.get(EXTENSION_QUIC_TRANSPORT_PARAMETERS);
  if (transportParameters === undefined || (offeredAlpn.length > 0 && alpn === undefined)) {
    // RFC 9001 section 8.1: a server that selects no offered protocol must abort instead.
    return failQuic("CONNECTION_FAILED");
  }
  return alpn === undefined ? { transportParameters } : { transportParameters, alpn };
}

/** Returns the end-entity certificate from a Certificate message; the chain is not validated. */
export function parseCertificate(body: Uint8Array): Uint8Array {
  const reader = new WireReader(body);
  if (reader.vector(1).byteLength !== 0) {
    return failQuic("MALFORMED_RESPONSE");
  }
  const list = new WireReader(reader.vector(3));
  expectEnd(reader);
  const certificates: Uint8Array[] = [];
  while (list.remaining > 0) {
    certificates.push(list.vector(3));
    list.vector(2);
    if (certificates.length > MAX_CERTIFICATES) {
      return failQuic("MALFORMED_RESPONSE");
    }
  }
  return certificates[0] ?? failQuic("MALFORMED_RESPONSE");
}

function certificateKey(certificate: Uint8Array): KeyObject {
  try {
    return new X509Certificate(certificate).publicKey;
  } catch {
    return failQuic("MALFORMED_RESPONSE");
  }
}

/**
 * Checks that the server holds the private key of the certificate it presented (RFC 8446 section
 * 4.4.3). This binds the handshake to that key; it does not establish who the key belongs to.
 */
export function verifyCertificateVerify(
  body: Uint8Array,
  certificate: Uint8Array,
  transcriptHash: Uint8Array,
): void {
  const reader = new WireReader(body);
  const scheme = SIGNATURE_SCHEMES.get(reader.u16());
  const signature = reader.vector(2);
  expectEnd(reader);
  if (scheme === undefined) {
    failQuic("MALFORMED_RESPONSE");
  }
  const key = certificateKey(certificate);
  const details = key.asymmetricKeyDetails;
  const keyMatches =
    scheme.kind === "ecdsa"
      ? key.asymmetricKeyType === "ec" && details?.namedCurve === scheme.curve
      : scheme.kind === "ed25519"
        ? key.asymmetricKeyType === "ed25519"
        : key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss";
  const signed = concatBytes([CERTIFICATE_VERIFY_CONTEXT, transcriptHash]);
  let valid = false;
  if (keyMatches) {
    try {
      valid =
        scheme.kind === "rsa-pss"
          ? verify(
              scheme.hash,
              signed,
              {
                key,
                padding: constants.RSA_PKCS1_PSS_PADDING,
                saltLength: scheme.saltLength ?? HASH_BYTES,
              },
              signature,
            )
          : verify(
              scheme.hash,
              signed,
              scheme.kind === "ecdsa" ? { key, dsaEncoding: "der" } : key,
              signature,
            );
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    failQuic("CONNECTION_FAILED");
  }
}

/** Traffic secrets from the TLS 1.3 key schedule (RFC 8446 section 7.1). */
export interface HandshakeSecrets {
  readonly client: Uint8Array;
  readonly server: Uint8Array;
  readonly handshakeSecret: Uint8Array;
}

export function handshakeSecrets(
  sharedSecret: Uint8Array,
  transcriptHash: Uint8Array,
): HandshakeSecrets {
  const zeros = new Uint8Array(HASH_BYTES);
  const earlySecret = hkdfExtract(zeros, zeros);
  const handshakeSecret = hkdfExtract(deriveSecret(earlySecret, "derived", sha256()), sharedSecret);
  return {
    client: deriveSecret(handshakeSecret, "c hs traffic", transcriptHash),
    server: deriveSecret(handshakeSecret, "s hs traffic", transcriptHash),
    handshakeSecret,
  };
}

export function applicationSecrets(
  handshakeSecret: Uint8Array,
  transcriptHash: Uint8Array,
): { readonly client: Uint8Array; readonly server: Uint8Array } {
  const zeros = new Uint8Array(HASH_BYTES);
  const masterSecret = hkdfExtract(deriveSecret(handshakeSecret, "derived", sha256()), zeros);
  return {
    client: deriveSecret(masterSecret, "c ap traffic", transcriptHash),
    server: deriveSecret(masterSecret, "s ap traffic", transcriptHash),
  };
}

/** Finished verify_data for one side's handshake traffic secret. */
export function finishedVerifyData(
  trafficSecret: Uint8Array,
  transcriptHash: Uint8Array,
): Uint8Array {
  return hmacSha256(
    hkdfExpandLabel(trafficSecret, "finished", new Uint8Array(0), HASH_BYTES),
    transcriptHash,
  );
}

export function encodeFinished(verifyData: Uint8Array): Uint8Array {
  return new WireWriter().u8(MESSAGE_FINISHED).vector(3, verifyData).finish();
}

/** Handshake message types the connection dispatches on. */
export const HANDSHAKE_MESSAGE: {
  readonly serverHello: number;
  readonly newSessionTicket: number;
  readonly encryptedExtensions: number;
  readonly certificate: number;
  readonly certificateRequest: number;
  readonly certificateVerify: number;
  readonly finished: number;
} = Object.freeze({
  serverHello: MESSAGE_SERVER_HELLO,
  newSessionTicket: MESSAGE_NEW_SESSION_TICKET,
  encryptedExtensions: MESSAGE_ENCRYPTED_EXTENSIONS,
  certificate: MESSAGE_CERTIFICATE,
  certificateRequest: MESSAGE_CERTIFICATE_REQUEST,
  certificateVerify: MESSAGE_CERTIFICATE_VERIFY,
  finished: MESSAGE_FINISHED,
});
