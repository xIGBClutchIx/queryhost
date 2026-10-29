/**
 * Minimal real-socket QUIC v1 server for transport integration tests.
 *
 * It serves one connection with the client's own packet, frame, and key-schedule modules, so a
 * successful exchange proves the client against an independent server-side handshake: a server
 * certificate, a CertificateVerify signature, both Finished MACs, and real AES-GCM packets. Fault
 * switches cover Retry, Version Negotiation, loss, and protocol violations.
 */

import { createPrivateKey, randomBytes, sign, X509Certificate } from "node:crypto";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { readFileSync } from "node:fs";

import {
  initialProtection,
  packetProtection,
  retryIntegrityTag,
  sha256,
  type PacketProtection,
} from "../../src/transports/quic/crypto.js";
import {
  encodeAck,
  encodeApplicationClose,
  encodeCrypto,
  encodeStream,
  parseFrames,
} from "../../src/transports/quic/frames.js";
import {
  openPacket,
  protectLongPacket,
  protectShortPacket,
  splitDatagram,
  QUIC_VERSION_1,
  type PacketSpace,
} from "../../src/transports/quic/packet.js";
import {
  applicationSecrets,
  finishedVerifyData,
  handshakeSecrets,
  readHandshakeMessages,
  x25519KeyShare,
  type HandshakeSecrets,
} from "../../src/transports/quic/tls.js";
import { bytesEqual, concatBytes, WireReader, WireWriter } from "../../src/transports/quic/wire.js";

const CERTIFICATE = new X509Certificate(
  readFileSync(new URL("../fixtures/quic/server-cert.pem", import.meta.url)),
).raw;
const PRIVATE_KEY = createPrivateKey(
  readFileSync(new URL("../fixtures/quic/server-key.pem", import.meta.url)),
);
const SERVER_ID_BYTES = 8;
const CERTIFICATE_VERIFY_CONTEXT = concatBytes([
  new Uint8Array(64).fill(0x20),
  new TextEncoder().encode("TLS 1.3, server CertificateVerify"),
  Uint8Array.of(0),
]);

/** Fault and shape switches for one fake server. */
export interface FakeQuicBehavior {
  /** Response for the request stream; echoes the request by default. */
  readonly respond?: (request: Uint8Array) => Uint8Array;
  /** Stream bytes per 1-RTT packet; the whole response by default. */
  readonly chunkBytes?: number;
  /** Sends response packets last-first, so the client must reassemble them. */
  readonly reverseChunks?: boolean;
  /** Answers the first Initial with a Retry. */
  readonly retry?: boolean;
  /** Answers every Initial with Version Negotiation offering only an unknown version. */
  readonly versionNegotiation?: boolean;
  /** Ignores every datagram. */
  readonly silent?: boolean;
  /** Drops this many client datagrams before processing any. */
  readonly dropFirstDatagrams?: number;
  readonly corruptFinished?: boolean;
  /** Echoes a different original_destination_connection_id than the client used. */
  readonly wrongOriginalDestination?: boolean;
  /** Sends CONNECTION_CLOSE once the request arrives instead of answering. */
  readonly closeInsteadOfResponding?: boolean;
  /** Protocol selected in EncryptedExtensions. */
  readonly alpn?: string;
}

/** Observable server state for assertions. */
export interface FakeQuicServer {
  readonly host: string;
  readonly port: number;
  /** Client datagrams received, including dropped ones. */
  readonly datagrams: () => number;
  readonly requests: Uint8Array[];
  readonly serverNames: (string | undefined)[];
  readonly offeredAlpn: string[][];
  /** Whether the client's Finished matched the transcript. */
  readonly clientFinishedValid: () => boolean | undefined;
  readonly closeReceived: () => boolean;
}

interface ClientHello {
  readonly bytes: Uint8Array;
  readonly keyShare: Uint8Array;
  readonly serverName: string | undefined;
  readonly alpn: string[];
}

function message(type: number, body: Uint8Array): Uint8Array {
  return new WireWriter().u8(type).vector(3, body).finish();
}

function parseClientHello(bytes: Uint8Array): ClientHello {
  const reader = new WireReader(bytes.subarray(4));
  reader.u16();
  reader.bytes(32);
  reader.vector(1);
  reader.vector(2);
  reader.vector(1);
  const extensions = new WireReader(reader.vector(2));
  let keyShare: Uint8Array | undefined;
  let serverName: string | undefined;
  const alpn: string[] = [];
  while (extensions.remaining > 0) {
    const type = extensions.u16();
    const data = new WireReader(extensions.vector(2));
    if (type === 0) {
      const list = new WireReader(data.vector(2));
      list.u8();
      serverName = new TextDecoder().decode(list.vector(2));
    } else if (type === 16) {
      const list = new WireReader(data.vector(2));
      while (list.remaining > 0) {
        alpn.push(new TextDecoder().decode(list.vector(1)));
      }
    } else if (type === 51) {
      const shares = new WireReader(data.vector(2));
      shares.u16();
      keyShare = shares.vector(2);
    }
  }
  if (keyShare === undefined) {
    throw new Error("The ClientHello carried no key share.");
  }
  return { bytes, keyShare, serverName, alpn };
}

function transportParameters(
  originalDestination: Uint8Array,
  serverId: Uint8Array,
  retrySource: Uint8Array | undefined,
): Uint8Array {
  const writer = new WireWriter();
  const bytes = (id: number, value: Uint8Array): void => {
    writer.varint(id).varint(value.byteLength).bytes(value);
  };
  const integer = (id: number, value: number): void => {
    bytes(id, new WireWriter().varint(value).finish());
  };
  bytes(0x00, originalDestination);
  bytes(0x0f, serverId);
  if (retrySource !== undefined) {
    bytes(0x10, retrySource);
  }
  integer(0x04, 1 << 20);
  integer(0x06, 1 << 20);
  integer(0x08, 4);
  // A GREASE identifier above 2^53, which quinn and other stacks send (RFC 9000 section 18.1).
  writer
    .bytes(Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff))
    .varint(1)
    .u8(7);
  return writer.finish();
}

const OPEN_SERVERS = new Set<Socket>();

/** Starts a fake QUIC server on an ephemeral loopback port. */
export async function startFakeQuicServer(
  behavior: FakeQuicBehavior = {},
): Promise<FakeQuicServer> {
  const socket = createSocket("udp4");
  const serverId = new Uint8Array(randomBytes(SERVER_ID_BYTES));
  const nextPacketNumber: Record<PacketSpace, number> = {
    initial: 0,
    handshake: 0,
    application: 0,
  };
  const largest: Record<PacketSpace, number> = { initial: -1, handshake: -1, application: -1 };
  const requests: Uint8Array[] = [];
  const serverNames: (string | undefined)[] = [];
  const offeredAlpn: string[][] = [];

  let datagrams = 0;
  let dropped = 0;
  let originalDestination: Uint8Array | undefined;
  let retrySource: Uint8Array | undefined;
  let clientId: Uint8Array | undefined;
  let initialKeys: { client: PacketProtection; server: PacketProtection } | undefined;
  let handshake: { secrets: HandshakeSecrets; transcript: Uint8Array[] } | undefined;
  let flight: { serverHello: Uint8Array; handshakeMessages: Uint8Array } | undefined;
  let application: { client: PacketProtection; server: PacketProtection } | undefined;
  let clientFinishedValid: boolean | undefined;
  let closeReceived = false;
  let request = new Uint8Array(0);
  let response: Uint8Array | undefined;

  const send = (datagram: Uint8Array, remote: RemoteInfo): void => {
    socket.send(datagram, remote.port, remote.address);
  };
  const packetNumber = (space: PacketSpace): number => {
    const value = nextPacketNumber[space];
    nextPacketNumber[space] += 1;
    return value;
  };
  const longPacket = (
    type: "initial" | "handshake",
    keys: PacketProtection,
    frames: readonly Uint8Array[],
  ): Uint8Array =>
    protectLongPacket({
      type,
      destination: clientId ?? new Uint8Array(0),
      source: serverId,
      packetNumber: packetNumber(type),
      payload: concatBytes(frames),
      keys,
    });
  const shortPacket = (frames: readonly Uint8Array[]): Uint8Array =>
    protectShortPacket({
      destination: clientId ?? new Uint8Array(0),
      packetNumber: packetNumber("application"),
      payload: concatBytes(frames),
      keys: application?.server ?? initialProtection(serverId).server,
    });

  const buildFlight = (hello: ClientHello): void => {
    const serverShare = x25519KeyShare(new Uint8Array(randomBytes(32)));
    const serverHello = message(
      2,
      new WireWriter()
        .u16(0x0303)
        .bytes(new Uint8Array(randomBytes(32)))
        .vector(1, new Uint8Array(0))
        .u16(0x1301)
        .u8(0)
        .vector(
          2,
          new WireWriter()
            .u16(43)
            .vector(2, new WireWriter().u16(0x0304).finish())
            .u16(51)
            .vector(2, new WireWriter().u16(0x001d).vector(2, serverShare.publicKey).finish())
            .finish(),
        )
        .finish(),
    );
    const transcript = [hello.bytes, serverHello];
    const secrets = handshakeSecrets(
      serverShare.sharedSecret(hello.keyShare),
      sha256(...transcript),
    );

    const echoedOriginal =
      behavior.wrongOriginalDestination === true
        ? new Uint8Array(8)
        : (originalDestination ?? new Uint8Array(0));
    const extensions = new WireWriter()
      .u16(57)
      .vector(2, transportParameters(echoedOriginal, serverId, retrySource));
    if (behavior.alpn !== undefined) {
      extensions
        .u16(16)
        .vector(
          2,
          new WireWriter()
            .vector(2, new WireWriter().vector(1, new TextEncoder().encode(behavior.alpn)).finish())
            .finish(),
        );
    }
    const encryptedExtensions = message(
      8,
      new WireWriter().vector(2, extensions.finish()).finish(),
    );
    transcript.push(encryptedExtensions);
    const certificate = message(
      11,
      new WireWriter()
        .vector(1, new Uint8Array(0))
        .vector(3, new WireWriter().vector(3, CERTIFICATE).vector(2, new Uint8Array(0)).finish())
        .finish(),
    );
    transcript.push(certificate);
    const signature = sign(
      "sha256",
      concatBytes([CERTIFICATE_VERIFY_CONTEXT, sha256(...transcript)]),
      { key: PRIVATE_KEY, dsaEncoding: "der" },
    );
    const certificateVerify = message(
      15,
      new WireWriter().u16(0x0403).vector(2, new Uint8Array(signature)).finish(),
    );
    transcript.push(certificateVerify);
    const verifyData = finishedVerifyData(secrets.server, sha256(...transcript));
    if (behavior.corruptFinished === true) {
      verifyData[0] = (verifyData[0] ?? 0) ^ 0xff;
    }
    const finished = message(20, verifyData);
    transcript.push(finished);
    const appSecrets = applicationSecrets(secrets.handshakeSecret, sha256(...transcript));
    handshake = { secrets, transcript };
    application = {
      client: packetProtection(appSecrets.client),
      server: packetProtection(appSecrets.server),
    };
    flight = {
      serverHello,
      handshakeMessages: concatBytes([
        encryptedExtensions,
        certificate,
        certificateVerify,
        finished,
      ]),
    };
  };

  const sendFlight = (remote: RemoteInfo, clientPacketNumber: number): void => {
    if (flight === undefined || initialKeys === undefined || handshake === undefined) {
      return;
    }
    send(
      concatBytes([
        longPacket("initial", initialKeys.server, [
          encodeAck([{ smallest: clientPacketNumber, largest: clientPacketNumber }]),
          encodeCrypto(0, flight.serverHello),
        ]),
        longPacket("handshake", packetProtection(handshake.secrets.server), [
          encodeCrypto(0, flight.handshakeMessages),
        ]),
      ]),
      remote,
    );
  };

  const sendResponse = (remote: RemoteInfo): void => {
    if (behavior.closeInsteadOfResponding === true) {
      send(shortPacket([encodeApplicationClose()]), remote);
      return;
    }
    response ??= (behavior.respond ?? ((data: Uint8Array): Uint8Array => data))(request);
    const chunkBytes = Math.max(1, behavior.chunkBytes ?? response.byteLength);
    const packets: Uint8Array[] = [];
    for (let offset = 0; offset < response.byteLength || offset === 0; offset += chunkBytes) {
      const chunk = response.subarray(offset, offset + chunkBytes);
      const fin = offset + chunkBytes >= response.byteLength;
      const frames = [encodeStream(0, offset, chunk, fin)];
      if (offset === 0) {
        // Session tickets and HANDSHAKE_DONE ride along, as real servers send them.
        frames.unshift(Uint8Array.of(0x1e), encodeCrypto(0, message(4, new Uint8Array(12))));
      }
      packets.push(shortPacket(frames));
      if (fin) {
        break;
      }
    }
    if (behavior.reverseChunks === true) {
      packets.reverse();
    }
    for (const packet of packets) {
      send(packet, remote);
    }
  };

  const handle = (datagram: Uint8Array, remote: RemoteInfo): void => {
    datagrams += 1;
    if (behavior.silent === true || dropped < (behavior.dropFirstDatagrams ?? 0)) {
      dropped += 1;
      return;
    }
    for (const packet of splitDatagram(datagram, SERVER_ID_BYTES)) {
      if (packet.kind !== "protected") {
        continue;
      }
      if (packet.space === "initial") {
        originalDestination ??= Uint8Array.from(packet.destination);
        const source = Uint8Array.from(packet.source ?? new Uint8Array(0));
        if (behavior.versionNegotiation === true) {
          send(
            new WireWriter()
              .u8(0x80)
              .u32(0)
              .vector(1, source)
              .vector(1, packet.destination)
              .u32(0x0a0a_0a0a)
              .finish(),
            remote,
          );
          return;
        }
        if (behavior.retry === true && retrySource === undefined) {
          retrySource = new Uint8Array(randomBytes(SERVER_ID_BYTES));
          const withoutTag = new WireWriter()
            .u8(0xf0)
            .u32(QUIC_VERSION_1)
            .vector(1, source)
            .vector(1, retrySource)
            .bytes(new TextEncoder().encode("retry-token"))
            .finish();
          send(
            concatBytes([withoutTag, retryIntegrityTag(originalDestination, withoutTag)]),
            remote,
          );
          return;
        }
        if (retrySource !== undefined && !bytesEqual(packet.destination, retrySource)) {
          continue;
        }
        clientId = source;
        initialKeys = initialProtection(packet.destination);
        const opened = openPacket(packet, initialKeys.client, largest.initial);
        if (opened === undefined) {
          continue;
        }
        largest.initial = Math.max(largest.initial, opened.packetNumber);
        for (const frame of parseFrames(opened.payload, "initial")) {
          if (frame.type === "crypto" && flight === undefined) {
            const hello = parseClientHello(
              readHandshakeMessages(frame.data).messages[0]?.bytes ?? new Uint8Array(0),
            );
            serverNames.push(hello.serverName);
            offeredAlpn.push(hello.alpn);
            buildFlight(hello);
          }
          if (frame.type === "crypto") {
            sendFlight(remote, opened.packetNumber);
          }
        }
      } else if (packet.space === "handshake" && handshake !== undefined) {
        const opened = openPacket(
          packet,
          packetProtection(handshake.secrets.client),
          largest.handshake,
        );
        if (opened === undefined) {
          continue;
        }
        largest.handshake = Math.max(largest.handshake, opened.packetNumber);
        for (const frame of parseFrames(opened.payload, "handshake")) {
          if (frame.type === "crypto") {
            const expected = finishedVerifyData(
              handshake.secrets.client,
              sha256(...handshake.transcript),
            );
            clientFinishedValid = bytesEqual(frame.data.subarray(4), expected);
          }
        }
      } else if (packet.space === "application" && application !== undefined) {
        const opened = openPacket(packet, application.client, largest.application);
        if (opened === undefined) {
          continue;
        }
        largest.application = Math.max(largest.application, opened.packetNumber);
        for (const frame of parseFrames(opened.payload, "application")) {
          if (frame.type === "connection-close") {
            closeReceived = true;
          } else if (frame.type === "stream" && frame.fin) {
            request = Uint8Array.from(frame.data);
            requests.push(request);
            sendResponse(remote);
          }
        }
      }
    }
  };

  socket.on("message", (datagram, remote): void => {
    handle(new Uint8Array(datagram), remote);
  });
  await new Promise<void>((resolve, reject): void => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", (): void => {
      socket.off("error", reject);
      resolve();
    });
  });
  OPEN_SERVERS.add(socket);
  const address = socket.address();

  return {
    host: "127.0.0.1",
    port: address.port,
    datagrams: (): number => datagrams,
    requests,
    serverNames,
    offeredAlpn,
    clientFinishedValid: (): boolean | undefined => clientFinishedValid,
    closeReceived: (): boolean => closeReceived,
  };
}

export async function stopAllFakeQuicServers(): Promise<void> {
  await Promise.all(
    [...OPEN_SERVERS].map(
      async (socket) =>
        new Promise<void>((resolve): void => {
          OPEN_SERVERS.delete(socket);
          try {
            socket.close(() => {
              resolve();
            });
          } catch {
            resolve();
          }
        }),
    ),
  );
}
