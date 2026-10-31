/** Bounded QUIC v1 request/response exchanges over one validated, pinned UDP destination. */

import { randomBytes } from "node:crypto";

import type { PinnedAddress, PinnedTarget } from "../network/target.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { QuicClientConnection, type QuicResponseState } from "./quic/connection.js";
import { QuicTransportError } from "./quic/errors.js";
import { addressesMatch, terminationCode } from "./shared.js";
import {
  NODE_UDP_DEPENDENCIES,
  peerMatches,
  type UdpSocketAdapter,
  type UdpTransportDependencies,
} from "./udp.js";

export { QuicTransportError, type QuicTransportErrorCode } from "./quic/errors.js";
export type { QuicResponseState } from "./quic/connection.js";

/** Requests must fit in one 1-RTT packet next to the handshake's final flight. */
const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_DATAGRAM_BYTES = 65_507;
const MAX_DATAGRAMS = 512;
/** Handshake, certificate, and retransmission bytes allowed on top of the response itself. */
const HANDSHAKE_BYTE_ALLOWANCE = 262_144;
/** First probe delay; RFC 9002's 333 ms initial RTT estimate, rounded for a status exchange. */
const INITIAL_PROBE_MS = 400;
const MAX_PROBES = 4;

/** Socket, clock, randomness, and timer boundaries for deterministic transport tests. */
export interface QuicTransportDependencies extends UdpTransportDependencies {
  randomBytes(length: number): Uint8Array;
  /** Schedules one callback and returns its cancellation. */
  schedule(callback: () => void, delayMs: number): () => void;
}

const NODE_DEPENDENCIES: QuicTransportDependencies = Object.freeze({
  ...NODE_UDP_DEPENDENCIES,
  randomBytes: (length: number): Uint8Array => new Uint8Array(randomBytes(length)),
  schedule(callback: () => void, delayMs: number): () => void {
    const timer = setTimeout(callback, delayMs);
    return (): void => {
      clearTimeout(timer);
    };
  },
});

/** Inputs for one bounded request on one QUIC stream. */
export interface QuicExchangeOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  /** One address selected from `target.addresses`; this transport never resolves DNS. */
  readonly address: PinnedAddress;
  /**
   * TLS server name chosen by the protocol: the target hostname, or a fixed identity the game's
   * servers expect. IP literals and `undefined` send no SNI.
   */
  readonly serverName: string | undefined;
  /** ALPN protocols to offer; omitted or empty offers none. */
  readonly alpn?: readonly string[];
  /**
   * QueryHost has no trust store for game servers' certificates, so identity validation is always
   * disabled and must be acknowledged explicitly. The handshake still requires the server to prove
   * it holds the presented certificate's key, and its Finished message to authenticate the
   * transcript, but nothing establishes who that key belongs to.
   */
  readonly tlsCertificatePolicy: "disabled";
  /** Request bytes sent, then finished, on the first client-initiated bidirectional stream. */
  readonly request: Uint8Array;
  /** Maximum response bytes from 1 through 1 MiB; also the stream's flow-control limit. */
  readonly maxResponseBytes: number;
  /**
   * Synchronous framing check, called each time the contiguous response prefix grows; must report
   * `complete` by stream end. It receives a view of the transport's buffer that is valid only for
   * the call and must be neither retained nor modified.
   */
  readonly inspectResponse: (data: Uint8Array) => QuicResponseState;
}

/** Complete bounded response and transport measurements. */
export interface QuicExchangeResult {
  readonly data: Uint8Array;
  /** Time from the first Initial packet to the complete response, handshake included. */
  readonly rttMs: number;
  readonly address: PinnedAddress;
  readonly port: number;
}

function validateOptions(options: QuicExchangeOptions): void {
  if (
    !Number.isSafeInteger(options.target.port) ||
    options.target.port < 1 ||
    options.target.port > 65_535 ||
    options.request.byteLength < 1 ||
    options.request.byteLength > MAX_REQUEST_BYTES ||
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes < 1 ||
    options.maxResponseBytes > MAX_RESPONSE_BYTES ||
    (options.alpn ?? []).some((protocol) => protocol.length < 1 || protocol.length > 255) ||
    !options.target.addresses.some((address) => addressesMatch(address, options.address))
  ) {
    throw new QuicTransportError("INVALID_INPUT");
  }
}

/**
 * Performs a QUIC handshake with one pinned address, sends one request on one stream, and
 * resolves with the server's complete answer on that stream.
 *
 * The connected socket accepts datagrams only from the selected peer. Silent intervals trigger at
 * most four probes with doubling delay; the scope's deadline bounds the whole exchange. Success,
 * failure, timeout, and cancellation all close the socket once, after a best-effort
 * CONNECTION_CLOSE so the server can release its connection state.
 */
export function quicExchange(
  options: QuicExchangeOptions,
  dependencies: QuicTransportDependencies = NODE_DEPENDENCIES,
): Promise<QuicExchangeResult> {
  return new Promise((resolve, reject): void => {
    validateOptions(options);
    if (options.scope.signal.aborted) {
      reject(new QuicTransportError(terminationCode(options.scope)));
      return;
    }
    options.scope.consumeOutboundAttempts();

    let connection: QuicClientConnection;
    let socket: UdpSocketAdapter;
    try {
      connection = new QuicClientConnection({
        serverName: options.serverName,
        alpn: options.alpn ?? [],
        request: options.request,
        maxResponseBytes: options.maxResponseBytes,
        inspectResponse: options.inspectResponse,
        randomBytes: (length) => dependencies.randomBytes(length),
      });
      socket = dependencies.createSocket(options.address.family);
    } catch {
      reject(new QuicTransportError("CONNECTION_FAILED"));
      return;
    }

    let closed = false;
    let settled = false;
    let connected = false;
    let unregisterCleanup = (): void => undefined;
    let cancelProbe = (): void => undefined;
    let probes = 0;
    let datagrams = 0;
    let receivedBytes = 0;
    let startedMs = 0;
    const maxReceivedBytes = options.maxResponseBytes + HANDSHAKE_BYTE_ALLOWANCE;

    const closeSocket = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      unregisterCleanup();
      try {
        socket.close();
      } catch {
        // Cleanup errors cannot replace the exchange outcome.
      }
    };

    const send = (datagram: Uint8Array, completion?: () => void): void => {
      try {
        socket.send(datagram, (error): void => {
          completion?.();
          if (error !== undefined) {
            finish(new QuicTransportError("CONNECTION_FAILED"));
          }
        });
      } catch {
        completion?.();
        finish(new QuicTransportError("CONNECTION_FAILED"));
      }
    };

    const finish = (result: QuicExchangeResult | QuicTransportError): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.scope.signal.removeEventListener("abort", handleAbort);
      cancelProbe();
      let close: Uint8Array | undefined;
      try {
        close = connected ? connection.close() : undefined;
      } catch {
        close = undefined;
      }
      if (close === undefined) {
        closeSocket();
      } else {
        // The scope's cleanup still closes the socket if this send never completes.
        send(close, closeSocket);
      }
      if (result instanceof QuicTransportError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const handleAbort = (): void => {
      finish(new QuicTransportError(terminationCode(options.scope)));
    };

    const scheduleProbe = (): void => {
      cancelProbe();
      if (probes >= MAX_PROBES) {
        return;
      }
      cancelProbe = dependencies.schedule(
        (): void => {
          if (settled) {
            return;
          }
          probes += 1;
          try {
            for (const datagram of connection.probe()) {
              send(datagram);
            }
          } catch (error) {
            finish(
              error instanceof QuicTransportError
                ? error
                : new QuicTransportError("CONNECTION_FAILED"),
            );
            return;
          }
          scheduleProbe();
        },
        INITIAL_PROBE_MS * 2 ** probes,
      );
    };

    socket.onError((): void => {
      finish(new QuicTransportError("CONNECTION_FAILED"));
    });

    socket.onMessage((message, peer): void => {
      // Validate the peer before interpreting its size so an unrelated sender cannot fail a query.
      if (settled || !peerMatches(peer, options.address, options.target.port)) {
        return;
      }
      if (peer.size !== message.byteLength || message.byteLength === 0) {
        finish(new QuicTransportError("MALFORMED_RESPONSE"));
        return;
      }
      datagrams += 1;
      receivedBytes += message.byteLength;
      if (
        message.byteLength > MAX_DATAGRAM_BYTES ||
        datagrams > MAX_DATAGRAMS ||
        receivedBytes > maxReceivedBytes
      ) {
        finish(new QuicTransportError("RESPONSE_TOO_LARGE"));
        return;
      }
      let replies: Uint8Array[];
      try {
        replies = connection.receive(Uint8Array.from(message));
      } catch (error) {
        // Anything else thrown while handling peer bytes is a parser or crypto rejection of them.
        finish(
          error instanceof QuicTransportError
            ? error
            : new QuicTransportError("MALFORMED_RESPONSE"),
        );
        return;
      }
      const response = connection.response;
      if (response !== undefined) {
        finish({
          data: response,
          rttMs: Math.max(0, dependencies.now() - startedMs),
          address: options.address,
          port: options.target.port,
        });
        return;
      }
      for (const datagram of replies) {
        send(datagram);
      }
      // Any answer is progress, so the next probe waits a full interval from here.
      probes = 0;
      scheduleProbe();
    });

    options.scope.signal.addEventListener("abort", handleAbort, { once: true });
    unregisterCleanup = options.scope.addCleanup(closeSocket);
    // Close the small race between the initial check and abort-listener registration.
    if (options.scope.signal.aborted) {
      handleAbort();
      return;
    }
    try {
      socket.connect(options.target.port, options.address.address, (): void => {
        if (settled) {
          return;
        }
        connected = true;
        startedMs = dependencies.now();
        for (const datagram of connection.start()) {
          send(datagram);
        }
        scheduleProbe();
      });
    } catch {
      finish(new QuicTransportError("CONNECTION_FAILED"));
    }
  });
}
