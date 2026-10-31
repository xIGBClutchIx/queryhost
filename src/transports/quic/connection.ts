/**
 * A socket-free QUIC v1 client connection that performs one request/response exchange on one
 * client-initiated bidirectional stream.
 *
 * The connection consumes and produces whole datagrams; the transport owns the socket, timers,
 * deadline, and peer filtering. It implements the subset of RFC 9000/9001 such an exchange needs:
 * the TLS 1.3 handshake, Retry, Version Negotiation, CRYPTO and STREAM reassembly, acknowledgements,
 * and probe retransmission. It never accepts peer-initiated streams, migrates, or updates keys.
 */

import { timingSafeEqual } from "node:crypto";

import {
  initialProtection,
  packetProtection,
  retryIntegrityTag,
  sha256,
  type PacketProtection,
} from "./crypto.js";
import { failQuic } from "./errors.js";
import {
  encodeAck,
  encodeApplicationClose,
  encodeCrypto,
  encodePathResponse,
  encodePing,
  encodeStream,
  encodeTransportClose,
  isAckEliciting,
  parseFrames,
  type Frame,
  type PacketRange,
} from "./frames.js";
import {
  longPacketOverhead,
  openPacket,
  protectLongPacket,
  protectShortPacket,
  splitDatagram,
  QUIC_VERSION_1,
  type PacketSpace,
  type ProtectedPacket,
  type RetryPacket,
  type VersionNegotiationPacket,
} from "./packet.js";
import {
  applicationSecrets,
  encodeClientHello,
  encodeFinished,
  finishedVerifyData,
  handshakeSecrets,
  HANDSHAKE_MESSAGE,
  parseCertificate,
  parseEncryptedExtensions,
  parseServerHello,
  readHandshakeMessages,
  verifyCertificateVerify,
  x25519KeyShare,
  type HandshakeMessage,
  type KeyShare,
} from "./tls.js";
import { encodeTransportParameters, parsePeerTransportParameters } from "./transport-parameters.js";
import { bytesEqual, concatBytes } from "./wire.js";

/** Connection IDs this client issues; eight bytes is the minimum for the first Initial DCID. */
export const LOCAL_CONNECTION_ID_BYTES = 8;
const INITIAL_DESTINATION_ID_BYTES = 8;
/** RFC 9000 section 14.1: every client datagram carrying an Initial packet is padded to 1,200. */
export const MIN_INITIAL_DATAGRAM_BYTES = 1_200;
const MAX_CRYPTO_BYTES = 65_536;
const MAX_REASSEMBLY_RANGES = 64;
const MAX_ACK_RANGES = 32;
const MAX_DEFERRED_PACKETS = 8;
const IDLE_TIMEOUT_MS = 10_000;
/** The only stream this client opens: the first client-initiated bidirectional stream. */
const REQUEST_STREAM_ID = 0;
/** RFC 9000 section 20.1 transport error codes used when the client abandons a connection. */
const NO_ERROR = 0x00;

/** Protocol-owned assessment of the response bytes received so far. */
export type QuicResponseState = "complete" | "incomplete" | "malformed" | "too-large";

/** Inputs for one exchange. */
export interface QuicConnectionOptions {
  /** TLS server name; IP literals and `undefined` send no SNI. */
  readonly serverName: string | undefined;
  /** ALPN protocols to offer; empty sends no ALPN extension. */
  readonly alpn: readonly string[];
  readonly request: Uint8Array;
  readonly maxResponseBytes: number;
  /** Called when the contiguous prefix grows, with a view valid only during the call. */
  readonly inspectResponse: (data: Uint8Array) => QuicResponseState;
  readonly randomBytes: (length: number) => Uint8Array;
}

/** Contiguous-prefix reassembly of one byte stream with a hard size and fragmentation bound. */
class Reassembly {
  #buffer = new Uint8Array(0);
  #ranges: { start: number; end: number }[] = [];
  readonly #limit: number;

  public constructor(limit: number) {
    this.#limit = limit;
  }

  public get contiguousLength(): number {
    const first = this.#ranges[0];
    return first !== undefined && first.start === 0 ? first.end : 0;
  }

  /** The highest offset any received byte reached. */
  public get receivedEnd(): number {
    return this.#ranges.at(-1)?.end ?? 0;
  }

  /** Returns `false` when the data would exceed the limit; nothing is stored then. */
  public insert(offset: number, data: Uint8Array): boolean {
    const end = offset + data.byteLength;
    if (end > this.#limit) {
      return false;
    }
    if (data.byteLength === 0) {
      return true;
    }
    if (end > this.#buffer.byteLength) {
      const grown = new Uint8Array(
        Math.min(this.#limit, Math.max(end, this.#buffer.byteLength * 2)),
      );
      grown.set(this.#buffer);
      this.#buffer = grown;
    }
    this.#buffer.set(data, offset);
    const ranges = [...this.#ranges, { start: offset, end }].sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last !== undefined && range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }
    if (merged.length > MAX_REASSEMBLY_RANGES) {
      // A peer scattering tiny fragments cannot make reassembly unbounded work.
      return failQuic("MALFORMED_RESPONSE");
    }
    this.#ranges = merged;
    return true;
  }

  public contiguous(): Uint8Array {
    return this.#buffer.subarray(0, this.contiguousLength);
  }
}

interface SpaceState {
  sendKeys: PacketProtection | undefined;
  receiveKeys: PacketProtection | undefined;
  nextPacketNumber: number;
  largestReceived: number;
  /** Received packet numbers, largest range first, for duplicate detection and ACK frames. */
  received: PacketRange[];
  ackPending: boolean;
  readonly crypto: Reassembly;
  cryptoConsumed: number;
  discarded: boolean;
}

function createSpace(): SpaceState {
  return {
    sendKeys: undefined,
    receiveKeys: undefined,
    nextPacketNumber: 0,
    largestReceived: -1,
    received: [],
    ackPending: false,
    crypto: new Reassembly(MAX_CRYPTO_BYTES),
    cryptoConsumed: 0,
    discarded: false,
  };
}

function hasPacket(ranges: readonly PacketRange[], packetNumber: number): boolean {
  return ranges.some((range) => packetNumber >= range.smallest && packetNumber <= range.largest);
}

function recordPacket(ranges: readonly PacketRange[], packetNumber: number): PacketRange[] {
  const sorted = [...ranges, { smallest: packetNumber, largest: packetNumber }].sort(
    (a, b) => b.largest - a.largest,
  );
  const merged: PacketRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.largest + 1 >= last.smallest) {
      merged[merged.length - 1] = {
        smallest: Math.min(last.smallest, range.smallest),
        largest: last.largest,
      };
    } else {
      merged.push(range);
    }
  }
  // Older ranges are forgotten first; the peer only stops retransmitting what it sees acknowledged.
  return merged.slice(0, MAX_ACK_RANGES);
}

type TlsState =
  | "server-hello"
  | "encrypted-extensions"
  | "certificate"
  | "certificate-verify"
  | "finished"
  | "connected";

/** One client connection; create a fresh instance for every attempt. */
export class QuicClientConnection {
  readonly #options: QuicConnectionOptions;
  readonly #localId: Uint8Array;
  readonly #originalDestination: Uint8Array;
  readonly #keyShare: KeyShare;
  readonly #clientHello: Uint8Array;
  readonly #spaces: Record<PacketSpace, SpaceState> = {
    initial: createSpace(),
    handshake: createSpace(),
    application: createSpace(),
  };

  #remoteId: Uint8Array;
  #remoteIdConfirmed = false;
  #retryToken: Uint8Array = new Uint8Array(0);
  #retrySource: Uint8Array | undefined;
  #receivedValidPacket = false;
  #deferred: ProtectedPacket[] = [];

  #tlsState: TlsState = "server-hello";
  readonly #transcript: Uint8Array[] = [];
  #certificate: Uint8Array | undefined;
  #handshakeSecret: Uint8Array | undefined;
  #clientHandshakeSecret: Uint8Array | undefined;
  #serverHandshakeSecret: Uint8Array | undefined;
  #clientFinished: Uint8Array | undefined;
  #handshakeConfirmed = false;

  #sendClientHello = true;
  #sendFinished = false;
  #sendRequest = false;
  #sendPing: PacketSpace | undefined;
  #pathResponses: Uint8Array[] = [];

  readonly #response: Reassembly;
  #finalSize: number | undefined;
  #complete: Uint8Array | undefined;
  /** Contiguous prefix length last given to `inspectResponse`, and its answer. */
  #inspectedLength = 0;
  #inspectedState: QuicResponseState | undefined;

  public constructor(options: QuicConnectionOptions) {
    this.#options = options;
    this.#localId = options.randomBytes(LOCAL_CONNECTION_ID_BYTES);
    this.#originalDestination = options.randomBytes(INITIAL_DESTINATION_ID_BYTES);
    this.#remoteId = this.#originalDestination;
    this.#keyShare = x25519KeyShare(options.randomBytes(32));
    this.#response = new Reassembly(options.maxResponseBytes);
    this.#installInitialKeys(this.#originalDestination);
    this.#clientHello = encodeClientHello({
      random: options.randomBytes(32),
      keyShare: this.#keyShare,
      serverName: options.serverName,
      alpn: options.alpn,
      transportParameters: encodeTransportParameters({
        sourceConnectionId: this.#localId,
        maxStreamData: options.maxResponseBytes,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
      }),
    });
    this.#transcript.push(this.#clientHello);
  }

  /** The complete response once the server finished the stream and the protocol accepted it. */
  public get response(): Uint8Array | undefined {
    return this.#complete;
  }

  /** The first flight: one padded datagram carrying the ClientHello. */
  public start(): Uint8Array[] {
    return this.#flush();
  }

  /**
   * Processes one datagram from the pinned peer and returns datagrams to send. Peer misbehavior
   * throws a {@link QuicTransportError}; unauthenticated or unrelated packets are dropped.
   */
  public receive(datagram: Uint8Array): Uint8Array[] {
    for (const packet of splitDatagram(datagram, LOCAL_CONNECTION_ID_BYTES)) {
      if (packet.kind === "version-negotiation") {
        this.#versionNegotiation(packet);
      } else if (packet.kind === "retry") {
        this.#retry(packet);
      } else {
        this.#protected(packet);
      }
      if (this.#complete !== undefined) {
        return [];
      }
    }
    return this.#flush();
  }

  /** Probe after a silent interval (RFC 9002 section 6.2): resend whatever is outstanding. */
  public probe(): Uint8Array[] {
    if (this.#complete !== undefined) {
      return [];
    }
    if (this.#spaces.handshake.receiveKeys === undefined) {
      this.#sendClientHello = true;
    } else if (this.#tlsState !== "connected") {
      this.#sendPing = "handshake";
    } else {
      this.#sendFinished = !this.#handshakeConfirmed;
      if (this.#response.receivedEnd === 0) {
        this.#sendRequest = true;
      } else {
        this.#sendPing = "application";
      }
    }
    return this.#flush();
  }

  /**
   * A best-effort CONNECTION_CLOSE so the server can release its state at once instead of waiting
   * out its idle timeout. Returns `undefined` when no close can be protected yet.
   */
  public close(): Uint8Array | undefined {
    const application = this.#spaces.application;
    if (application.sendKeys !== undefined) {
      return this.#shortPacket([encodeApplicationClose()]);
    }
    const handshake = this.#spaces.handshake;
    if (handshake.sendKeys !== undefined && !handshake.discarded) {
      return this.#longPacket("handshake", [encodeTransportClose(NO_ERROR)]);
    }
    return undefined;
  }

  #installInitialKeys(destination: Uint8Array): void {
    const keys = initialProtection(destination);
    this.#spaces.initial.sendKeys = keys.client;
    this.#spaces.initial.receiveKeys = keys.server;
  }

  #versionNegotiation(packet: VersionNegotiationPacket): void {
    // RFC 9000 section 6.2: ignore it after any valid packet, or when it lists our version.
    if (
      this.#receivedValidPacket ||
      !bytesEqual(packet.destination, this.#localId) ||
      !bytesEqual(packet.source, this.#originalDestination) ||
      packet.versions.includes(QUIC_VERSION_1)
    ) {
      return;
    }
    failQuic("CONNECTION_FAILED");
  }

  #retry(packet: RetryPacket): void {
    // RFC 9000 section 17.2.5.2: accept at most one Retry, and only before any Initial response.
    if (
      this.#retrySource !== undefined ||
      this.#receivedValidPacket ||
      packet.token.byteLength === 0 ||
      !bytesEqual(packet.destination, this.#localId) ||
      bytesEqual(packet.source, this.#originalDestination) ||
      !bytesEqual(retryIntegrityTag(this.#originalDestination, packet.withoutTag), packet.tag)
    ) {
      return;
    }
    this.#retrySource = packet.source;
    this.#retryToken = Uint8Array.from(packet.token);
    this.#remoteId = Uint8Array.from(packet.source);
    this.#installInitialKeys(this.#remoteId);
    this.#sendClientHello = true;
  }

  #protected(packet: ProtectedPacket): void {
    const space = this.#spaces[packet.space];
    if (!bytesEqual(packet.destination, this.#localId) || space.discarded) {
      return;
    }
    if (space.receiveKeys === undefined) {
      // Handshake or 1-RTT packets can overtake the ServerHello; keep a few until keys exist.
      if (packet.space !== "initial" && this.#deferred.length < MAX_DEFERRED_PACKETS) {
        this.#deferred.push({ ...packet, bytes: Uint8Array.from(packet.bytes) });
      }
      return;
    }
    if (packet.source !== undefined) {
      if (!this.#remoteIdConfirmed && packet.space === "initial") {
        // The server's first Initial fixes its connection ID for the rest of the connection.
        this.#remoteId = Uint8Array.from(packet.source);
        this.#remoteIdConfirmed = true;
      } else if (!this.#remoteIdConfirmed || !bytesEqual(packet.source, this.#remoteId)) {
        return;
      }
    }
    const opened = openPacket(packet, space.receiveKeys, space.largestReceived);
    if (opened === undefined || hasPacket(space.received, opened.packetNumber)) {
      return;
    }
    this.#receivedValidPacket = true;
    space.received = recordPacket(space.received, opened.packetNumber);
    space.largestReceived = Math.max(space.largestReceived, opened.packetNumber);
    const frames = parseFrames(opened.payload, packet.space);
    if (frames.some(isAckEliciting)) {
      space.ackPending = true;
    }
    for (const frame of frames) {
      this.#frame(packet.space, frame);
      if (this.#complete !== undefined || space.discarded) {
        return;
      }
    }
  }

  #frame(spaceName: PacketSpace, frame: Frame): void {
    switch (frame.type) {
      case "crypto":
        this.#crypto(spaceName, frame.offset, frame.data);
        return;
      case "stream":
        this.#stream(frame.streamId, frame.offset, frame.data, frame.fin);
        return;
      case "reset-stream":
        if (frame.streamId === REQUEST_STREAM_ID) {
          failQuic("CONNECTION_FAILED");
        }
        return failQuic("MALFORMED_RESPONSE");
      case "stream-data-blocked":
      case "data-blocked":
        // The server has more to send than the protocol's response limit allows.
        return failQuic("RESPONSE_TOO_LARGE");
      case "path-challenge":
        if (this.#pathResponses.length < 4) {
          this.#pathResponses.push(Uint8Array.from(frame.data));
        }
        return;
      case "connection-close":
        return failQuic("CONNECTION_FAILED");
      case "handshake-done":
        this.#confirmHandshake();
        return;
      case "ack":
      case "stop-sending":
      case "padding":
      case "other":
        return;
    }
  }

  #crypto(spaceName: PacketSpace, offset: number, data: Uint8Array): void {
    const space = this.#spaces[spaceName];
    if (!space.crypto.insert(offset, data)) {
      failQuic("MALFORMED_RESPONSE");
    }
    const available = space.crypto.contiguous().subarray(space.cryptoConsumed);
    const { messages, consumed } = readHandshakeMessages(available);
    space.cryptoConsumed += consumed;
    for (const message of messages) {
      this.#handshakeMessage(spaceName, message);
    }
  }

  #transcriptHash(): Uint8Array {
    return sha256(...this.#transcript);
  }

  #handshakeMessage(spaceName: PacketSpace, message: HandshakeMessage): void {
    if (spaceName === "application") {
      // Post-handshake session tickets are allowed and ignored: this client never resumes.
      if (message.type !== HANDSHAKE_MESSAGE.newSessionTicket) {
        failQuic("MALFORMED_RESPONSE");
      }
      return;
    }
    const expectedSpace = this.#tlsState === "server-hello" ? "initial" : "handshake";
    if (spaceName !== expectedSpace || this.#tlsState === "connected") {
      failQuic("MALFORMED_RESPONSE");
    }
    switch (this.#tlsState) {
      case "server-hello":
        this.#serverHello(message);
        return;
      case "encrypted-extensions":
        this.#encryptedExtensions(message);
        return;
      case "certificate":
        if (message.type === HANDSHAKE_MESSAGE.certificateRequest) {
          // Client certificates are never offered, so a server requiring one cannot be queried.
          failQuic("CONNECTION_FAILED");
        }
        this.#expect(message, HANDSHAKE_MESSAGE.certificate);
        this.#certificate = parseCertificate(message.body);
        this.#transcript.push(message.bytes);
        this.#tlsState = "certificate-verify";
        return;
      case "certificate-verify":
        this.#expect(message, HANDSHAKE_MESSAGE.certificateVerify);
        verifyCertificateVerify(
          message.body,
          this.#certificate ?? failQuic("MALFORMED_RESPONSE"),
          this.#transcriptHash(),
        );
        this.#transcript.push(message.bytes);
        this.#tlsState = "finished";
        return;
      case "finished":
        this.#serverFinished(message);
        return;
    }
  }

  #expect(message: HandshakeMessage, type: number): void {
    if (message.type !== type) {
      failQuic("MALFORMED_RESPONSE");
    }
  }

  #serverHello(message: HandshakeMessage): void {
    this.#expect(message, HANDSHAKE_MESSAGE.serverHello);
    const serverShare = parseServerHello(message.body);
    this.#transcript.push(message.bytes);
    const secrets = handshakeSecrets(
      this.#keyShare.sharedSecret(serverShare),
      this.#transcriptHash(),
    );
    this.#handshakeSecret = secrets.handshakeSecret;
    this.#clientHandshakeSecret = secrets.client;
    this.#serverHandshakeSecret = secrets.server;
    this.#spaces.handshake.sendKeys = packetProtection(secrets.client);
    this.#spaces.handshake.receiveKeys = packetProtection(secrets.server);
    this.#sendClientHello = false;
    this.#tlsState = "encrypted-extensions";
    this.#replayDeferred();
  }

  #encryptedExtensions(message: HandshakeMessage): void {
    this.#expect(message, HANDSHAKE_MESSAGE.encryptedExtensions);
    const extensions = parseEncryptedExtensions(message.body, this.#options.alpn);
    const peer = parsePeerTransportParameters(extensions.transportParameters, {
      originalDestination: this.#originalDestination,
      initialSource: this.#remoteId,
      retrySource: this.#retrySource,
    });
    const requestBytes = this.#options.request.byteLength;
    if (
      peer.maxStreamsBidi < 1 ||
      peer.maxStreamDataBidiRemote < requestBytes ||
      peer.maxData < requestBytes
    ) {
      // The server's limits would block the request, so waiting could only end in a timeout.
      failQuic("CONNECTION_FAILED");
    }
    this.#transcript.push(message.bytes);
    this.#tlsState = "certificate";
  }

  #serverFinished(message: HandshakeMessage): void {
    this.#expect(message, HANDSHAKE_MESSAGE.finished);
    const expected = finishedVerifyData(
      this.#serverHandshakeSecret ?? failQuic("MALFORMED_RESPONSE"),
      this.#transcriptHash(),
    );
    if (
      message.body.byteLength !== expected.byteLength ||
      !timingSafeEqual(message.body, expected)
    ) {
      failQuic("CONNECTION_FAILED");
    }
    this.#transcript.push(message.bytes);
    const transcriptHash = this.#transcriptHash();
    const secrets = applicationSecrets(
      this.#handshakeSecret ?? failQuic("MALFORMED_RESPONSE"),
      transcriptHash,
    );
    this.#clientFinished = encodeFinished(
      finishedVerifyData(
        this.#clientHandshakeSecret ?? failQuic("MALFORMED_RESPONSE"),
        transcriptHash,
      ),
    );
    this.#spaces.application.sendKeys = packetProtection(secrets.client);
    this.#spaces.application.receiveKeys = packetProtection(secrets.server);
    this.#tlsState = "connected";
    this.#sendFinished = true;
    this.#sendRequest = true;
    this.#replayDeferred();
  }

  #confirmHandshake(): void {
    // RFC 9001 section 4.9.2: Handshake keys are discarded once the handshake is confirmed.
    this.#handshakeConfirmed = true;
    this.#sendFinished = false;
    const handshake = this.#spaces.handshake;
    handshake.discarded = true;
    handshake.ackPending = false;
  }

  #replayDeferred(): void {
    const deferred = this.#deferred;
    this.#deferred = [];
    for (const packet of deferred) {
      this.#protected(packet);
    }
  }

  #stream(streamId: number, offset: number, data: Uint8Array, fin: boolean): void {
    if (streamId !== REQUEST_STREAM_ID) {
      // The client allows the server no streams of its own (RFC 9000 section 4.6).
      failQuic("MALFORMED_RESPONSE");
    }
    const end = offset + data.byteLength;
    if (
      (this.#finalSize !== undefined && end > this.#finalSize) ||
      (fin && this.#finalSize !== undefined && end !== this.#finalSize) ||
      (fin && end < this.#response.receivedEnd)
    ) {
      failQuic("MALFORMED_RESPONSE");
    }
    if (!this.#response.insert(offset, data)) {
      failQuic("RESPONSE_TOO_LARGE");
    }
    if (fin) {
      this.#finalSize = end;
    }
    const received = this.#response.contiguous();
    const finished = this.#finalSize !== undefined && received.byteLength === this.#finalSize;
    // Inspect only when the contiguous prefix grows (or once for an empty stream), so duplicate,
    // out-of-order, and zero-length frames cost no protocol work. The callback gets a view of the
    // reassembly buffer; only the final answer is copied.
    if (received.byteLength > this.#inspectedLength || this.#inspectedState === undefined) {
      this.#inspectedLength = received.byteLength;
      try {
        this.#inspectedState = this.#options.inspectResponse(received);
      } catch {
        this.#inspectedState = "malformed";
      }
    } else if (!finished) {
      return;
    }
    const state = this.#inspectedState;
    if (state === "malformed" || (state === "incomplete" && finished)) {
      failQuic("MALFORMED_RESPONSE");
    }
    if (state === "too-large") {
      failQuic("RESPONSE_TOO_LARGE");
    }
    if (state === "complete") {
      this.#complete = Uint8Array.from(received);
    }
  }

  #longPacket(type: "initial" | "handshake", frames: readonly Uint8Array[], padTo = 0): Uint8Array {
    const space = this.#spaces[type];
    const keys = space.sendKeys ?? failQuic("INVALID_INPUT");
    let payload = concatBytes(frames);
    const shape = {
      type,
      destination: this.#remoteId,
      source: this.#localId,
      token: this.#retryToken,
    };
    // Padding frames grow the Length varint too, so size the packet from its real overhead.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const shortfall = padTo - (longPacketOverhead({ ...shape, payload }) + payload.byteLength);
      if (shortfall <= 0) {
        break;
      }
      payload = concatBytes([payload, new Uint8Array(shortfall)]);
    }
    const packetNumber = space.nextPacketNumber;
    space.nextPacketNumber += 1;
    return protectLongPacket({ ...shape, packetNumber, payload, keys });
  }

  #shortPacket(frames: readonly Uint8Array[]): Uint8Array {
    const space = this.#spaces.application;
    const keys = space.sendKeys ?? failQuic("INVALID_INPUT");
    const packetNumber = space.nextPacketNumber;
    space.nextPacketNumber += 1;
    return protectShortPacket({
      destination: this.#remoteId,
      packetNumber,
      payload: concatBytes(frames),
      keys,
    });
  }

  #ack(space: SpaceState): Uint8Array[] {
    if (!space.ackPending || space.received.length === 0) {
      return [];
    }
    space.ackPending = false;
    return [encodeAck(space.received)];
  }

  /** Builds at most one datagram from everything currently owed to the server. */
  #flush(): Uint8Array[] {
    const initial = this.#spaces.initial;
    const handshake = this.#spaces.handshake;
    const application = this.#spaces.application;

    const handshakeFrames: Uint8Array[] = [];
    if (!handshake.discarded && handshake.sendKeys !== undefined) {
      handshakeFrames.push(...this.#ack(handshake));
      if (this.#sendFinished && this.#clientFinished !== undefined) {
        handshakeFrames.push(encodeCrypto(0, this.#clientFinished));
      }
      if (this.#sendPing === "handshake") {
        handshakeFrames.push(encodePing());
      }
    }
    this.#sendFinished = false;

    const applicationFrames: Uint8Array[] = [];
    if (application.sendKeys !== undefined) {
      applicationFrames.push(...this.#ack(application));
      for (const challenge of this.#pathResponses) {
        applicationFrames.push(encodePathResponse(challenge));
      }
      if (this.#sendRequest) {
        applicationFrames.push(encodeStream(REQUEST_STREAM_ID, 0, this.#options.request, true));
      }
      if (this.#sendPing === "application") {
        applicationFrames.push(encodePing());
      }
    }
    this.#pathResponses = [];
    this.#sendRequest = false;
    this.#sendPing = undefined;

    const packets: Uint8Array[] = [];
    if (handshakeFrames.length > 0) {
      packets.push(this.#longPacket("handshake", handshakeFrames));
      // RFC 9001 section 4.9.1: a client discards Initial keys once it sends a Handshake packet.
      initial.discarded = true;
      this.#sendClientHello = false;
    }
    if (applicationFrames.length > 0) {
      packets.push(this.#shortPacket(applicationFrames));
    }

    const initialFrames: Uint8Array[] = [];
    if (!initial.discarded) {
      initialFrames.push(...this.#ack(initial));
      if (this.#sendClientHello) {
        initialFrames.push(encodeCrypto(0, this.#clientHello));
      }
    }
    this.#sendClientHello = false;
    if (initialFrames.length > 0) {
      const others = packets.reduce((total, packet) => total + packet.byteLength, 0);
      packets.unshift(
        this.#longPacket("initial", initialFrames, MIN_INITIAL_DATAGRAM_BYTES - others),
      );
    }
    return packets.length === 0 ? [] : [concatBytes(packets)];
  }
}
