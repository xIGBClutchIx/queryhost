/** QUIC transport parameters exchanged inside the TLS handshake (RFC 9000 section 18). */

import { failQuic } from "./errors.js";
import { MAX_CONNECTION_ID_BYTES } from "./packet.js";
import { bytesEqual, WireReader, WireWriter } from "./wire.js";

const ORIGINAL_DESTINATION_CONNECTION_ID = 0x00;
const MAX_IDLE_TIMEOUT = 0x01;
const STATELESS_RESET_TOKEN = 0x02;
const MAX_UDP_PAYLOAD_SIZE = 0x03;
const INITIAL_MAX_DATA = 0x04;
const INITIAL_MAX_STREAM_DATA_BIDI_LOCAL = 0x05;
const INITIAL_MAX_STREAM_DATA_BIDI_REMOTE = 0x06;
const INITIAL_MAX_STREAM_DATA_UNI = 0x07;
const INITIAL_MAX_STREAMS_BIDI = 0x08;
const INITIAL_MAX_STREAMS_UNI = 0x09;
const ACK_DELAY_EXPONENT = 0x0a;
const MAX_ACK_DELAY = 0x0b;
const DISABLE_ACTIVE_MIGRATION = 0x0c;
const ACTIVE_CONNECTION_ID_LIMIT = 0x0e;
const INITIAL_SOURCE_CONNECTION_ID = 0x0f;
const RETRY_SOURCE_CONNECTION_ID = 0x10;

/** Largest UDP payload this client accepts, kept below common Ethernet path MTUs. */
export const LOCAL_MAX_UDP_PAYLOAD_BYTES = 1_472;
const MAX_TRANSPORT_PARAMETERS = 64;

/** Local limits advertised to the server. */
export interface LocalTransportParameters {
  readonly sourceConnectionId: Uint8Array;
  /** Response bytes the server may send on the client's stream, and on the connection overall. */
  readonly maxStreamData: number;
  readonly idleTimeoutMs: number;
}

/**
 * Encodes the client's parameters. The client accepts no peer-initiated streams and disables
 * migration, so the server can only answer on the one stream the client opens.
 */
export function encodeTransportParameters(local: LocalTransportParameters): Uint8Array {
  const writer = new WireWriter();
  const integer = (id: number, value: number): void => {
    const encoded = new WireWriter().varint(value).finish();
    writer.varint(id).varint(encoded.byteLength).bytes(encoded);
  };
  integer(MAX_IDLE_TIMEOUT, local.idleTimeoutMs);
  integer(MAX_UDP_PAYLOAD_SIZE, LOCAL_MAX_UDP_PAYLOAD_BYTES);
  integer(INITIAL_MAX_DATA, local.maxStreamData);
  integer(INITIAL_MAX_STREAM_DATA_BIDI_LOCAL, local.maxStreamData);
  integer(INITIAL_MAX_STREAM_DATA_BIDI_REMOTE, 0);
  integer(INITIAL_MAX_STREAM_DATA_UNI, 0);
  integer(INITIAL_MAX_STREAMS_BIDI, 0);
  integer(INITIAL_MAX_STREAMS_UNI, 0);
  writer.varint(DISABLE_ACTIVE_MIGRATION).varint(0);
  writer
    .varint(INITIAL_SOURCE_CONNECTION_ID)
    .varint(local.sourceConnectionId.byteLength)
    .bytes(local.sourceConnectionId);
  return writer.finish();
}

/** Connection IDs the server's parameters must echo to authenticate the handshake's routing. */
export interface ExpectedConnectionIds {
  readonly originalDestination: Uint8Array;
  readonly initialSource: Uint8Array;
  /** Present only when the server sent a Retry. */
  readonly retrySource: Uint8Array | undefined;
}

/** Server limits this client depends on. */
export interface PeerTransportParameters {
  readonly maxData: number;
  /** Bytes the client may send on a stream it opens. */
  readonly maxStreamDataBidiRemote: number;
  readonly maxStreamsBidi: number;
}

function integerValue(value: Uint8Array): number {
  const reader = new WireReader(value);
  const result = reader.varint();
  return reader.remaining === 0 ? result : failQuic("MALFORMED_RESPONSE");
}

/**
 * Parses and validates the server's parameters. The connection-ID checks are what stop an
 * on-path attacker from steering the handshake through a forged Initial or Retry (RFC 9000 7.3).
 */
export function parsePeerTransportParameters(
  data: Uint8Array,
  expected: ExpectedConnectionIds,
): PeerTransportParameters {
  const reader = new WireReader(data);
  const values = new Map<number, Uint8Array>();
  let count = 0;
  while (reader.remaining > 0) {
    // Reserved GREASE identifiers (31 * N + 27) span all 62 bits and are skipped like any unknown.
    const id = reader.varintOrUnknown();
    const value = reader.bytes(reader.varint());
    count += 1;
    if (count > MAX_TRANSPORT_PARAMETERS || (id !== undefined && values.has(id))) {
      return failQuic("MALFORMED_RESPONSE");
    }
    if (id !== undefined) {
      values.set(id, value);
    }
  }

  const original = values.get(ORIGINAL_DESTINATION_CONNECTION_ID);
  const initialSource = values.get(INITIAL_SOURCE_CONNECTION_ID);
  const retrySource = values.get(RETRY_SOURCE_CONNECTION_ID);
  if (
    original === undefined ||
    initialSource === undefined ||
    !bytesEqual(original, expected.originalDestination) ||
    !bytesEqual(initialSource, expected.initialSource) ||
    (expected.retrySource === undefined
      ? retrySource !== undefined
      : retrySource === undefined || !bytesEqual(retrySource, expected.retrySource))
  ) {
    return failQuic("CONNECTION_FAILED");
  }

  const integer = (id: number, fallback: number): number => {
    const value = values.get(id);
    return value === undefined ? fallback : integerValue(value);
  };
  const resetToken = values.get(STATELESS_RESET_TOKEN);
  if (
    (resetToken !== undefined && resetToken.byteLength !== 16) ||
    integer(MAX_UDP_PAYLOAD_SIZE, 65_527) < 1_200 ||
    integer(ACK_DELAY_EXPONENT, 3) > 20 ||
    integer(MAX_ACK_DELAY, 25) >= 2 ** 14 ||
    integer(ACTIVE_CONNECTION_ID_LIMIT, 2) < 2 ||
    (values.get(DISABLE_ACTIVE_MIGRATION)?.byteLength ?? 0) !== 0 ||
    initialSource.byteLength > MAX_CONNECTION_ID_BYTES
  ) {
    return failQuic("MALFORMED_RESPONSE");
  }
  integer(MAX_IDLE_TIMEOUT, 0);
  return {
    maxData: integer(INITIAL_MAX_DATA, 0),
    maxStreamDataBidiRemote: integer(INITIAL_MAX_STREAM_DATA_BIDI_REMOTE, 0),
    maxStreamsBidi: integer(INITIAL_MAX_STREAMS_BIDI, 0),
  };
}
