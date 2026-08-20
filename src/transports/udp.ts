/** Bounded UDP exchanges with strict peer, size, deadline, and cleanup boundaries. */

import { createSocket } from "node:dgram";
import { isIP } from "node:net";

import type { ExecutionScope } from "../execution.js";
import { normalizeIpAddress } from "../ip.js";
import type { QueryErrorCode } from "../shared.js";
import type { IpFamily, PinnedAddress, PinnedTarget } from "../target.js";

const MAX_UDP_DATAGRAM_BYTES = 65_507;

/** UDP failures that can be mapped directly into the stable query error contract. */
export type UdpTransportErrorCode = Extract<
  QueryErrorCode,
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
>;

const ERROR_MESSAGES: Readonly<Record<UdpTransportErrorCode, string>> = {
  ABORTED: "The UDP exchange was cancelled.",
  CONNECTION_FAILED: "The UDP exchange could not be completed.",
  INVALID_INPUT: "The UDP exchange input is invalid.",
  MALFORMED_RESPONSE: "The UDP response was malformed.",
  RESPONSE_TOO_LARGE: "The UDP response exceeded its size limit.",
  TIMEOUT: "The UDP exchange timed out.",
} as const;

/** Stable transport error that does not expose socket implementation details. */
export class UdpTransportError extends Error {
  public override readonly name = "UdpTransportError";
  public readonly code: UdpTransportErrorCode;

  public constructor(code: UdpTransportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** One remote peer reported alongside an incoming datagram. */
export interface UdpRemotePeer {
  readonly address: string;
  readonly port: number;
  /** Datagram byte count reported by the socket implementation. */
  readonly size: number;
}

/** Minimal socket boundary used by the production adapter and deterministic transport tests. */
export interface UdpSocketAdapter {
  onMessage(listener: (message: Uint8Array, peer: UdpRemotePeer) => void): void;
  onError(listener: (error: Error) => void): void;
  send(
    message: Uint8Array,
    port: number,
    address: string,
    completion: (error: Error | undefined) => void,
  ): void;
  close(): void;
}

/** Injectable platform boundaries for socket fault tests and monotonic timing. */
export interface UdpTransportDependencies {
  createSocket(family: IpFamily): UdpSocketAdapter;
  now(): number;
}

/** Inputs for one request and at most one accepted response. */
export interface UdpExchangeOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  /** One address selected from `target.addresses`; transports never perform DNS resolution. */
  readonly address: PinnedAddress;
  readonly request: Uint8Array;
  /** Maximum accepted response size from 1 through the UDP payload ceiling. */
  readonly maxResponseBytes: number;
}

/** Bounded datagram and transport measurements returned to a protocol implementation. */
export interface UdpExchangeResult {
  readonly data: Uint8Array;
  readonly rttMs: number;
  readonly address: PinnedAddress;
  readonly port: number;
}

/** Inputs for a request whose response may span multiple datagrams. */
export interface UdpCollectionOptions extends UdpExchangeOptions {
  /** Maximum accepted datagrams, including exact duplicates. */
  readonly maxDatagrams: number;
  /** Maximum combined bytes accepted across all matching datagrams. */
  readonly maxTotalResponseBytes: number;
  /** Protocol-owned completion check; transports do not interpret response contents. */
  readonly isComplete: (datagrams: readonly Uint8Array[]) => boolean;
}

/** Bounded datagrams and transport measurements returned to a protocol implementation. */
export interface UdpCollectionResult {
  readonly datagrams: readonly Uint8Array[];
  readonly rttMs: number;
  readonly address: PinnedAddress;
  readonly port: number;
}

function createNodeSocketAdapter(family: IpFamily): UdpSocketAdapter {
  const socket = createSocket(family === 4 ? "udp4" : "udp6");

  return {
    onMessage(listener: (message: Uint8Array, peer: UdpRemotePeer) => void): void {
      socket.on("message", (message, remote): void => {
        listener(message, {
          address: remote.address,
          port: remote.port,
          size: remote.size,
        });
      });
    },
    onError(listener: (error: Error) => void): void {
      socket.on("error", listener);
    },
    send(
      message: Uint8Array,
      port: number,
      address: string,
      completion: (error: Error | undefined) => void,
    ): void {
      socket.send(message, port, address, (error): void => {
        completion(error ?? undefined);
      });
    },
    close(): void {
      socket.close();
    },
  };
}

const NODE_DEPENDENCIES: UdpTransportDependencies = {
  createSocket: createNodeSocketAdapter,
  now: performance.now.bind(performance),
};

function fail(code: UdpTransportErrorCode): never {
  throw new UdpTransportError(code);
}

function addressesMatch(left: PinnedAddress, right: PinnedAddress): boolean {
  const normalizedLeft = normalizeIpAddress(left.address);
  const normalizedRight = normalizeIpAddress(right.address);
  return (
    normalizedLeft !== undefined &&
    normalizedRight !== undefined &&
    isIP(normalizedLeft) === left.family &&
    isIP(normalizedRight) === right.family &&
    left.family === right.family &&
    normalizedLeft === normalizedRight
  );
}

function validateOptions(options: UdpExchangeOptions): void {
  if (
    !Number.isSafeInteger(options.target.port) ||
    options.target.port < 1 ||
    options.target.port > 65_535 ||
    options.request.byteLength < 1 ||
    options.request.byteLength > MAX_UDP_DATAGRAM_BYTES ||
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes < 1 ||
    options.maxResponseBytes > MAX_UDP_DATAGRAM_BYTES ||
    !options.target.addresses.some((address) => addressesMatch(address, options.address))
  ) {
    fail("INVALID_INPUT");
  }
}

function validateCollectionOptions(options: UdpCollectionOptions): void {
  validateOptions(options);
  if (
    !Number.isSafeInteger(options.maxDatagrams) ||
    options.maxDatagrams < 1 ||
    !Number.isSafeInteger(options.maxTotalResponseBytes) ||
    options.maxTotalResponseBytes < options.maxResponseBytes ||
    options.maxTotalResponseBytes > MAX_UDP_DATAGRAM_BYTES
  ) {
    fail("INVALID_INPUT");
  }
}

function peerMatches(peer: UdpRemotePeer, address: PinnedAddress, port: number): boolean {
  const normalizedPeer = normalizeIpAddress(peer.address);
  const normalizedTarget = normalizeIpAddress(address.address);
  return normalizedPeer !== undefined && normalizedPeer === normalizedTarget && peer.port === port;
}

function terminationCode(scope: ExecutionScope): UdpTransportErrorCode {
  return scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED";
}

/**
 * Sends one datagram and resolves with the first bounded response from the selected pinned peer.
 *
 * Unrelated datagrams are ignored. A fresh socket prevents duplicate or late packets from a prior
 * request from being accepted by a later exchange. The caller retains ownership of the scope.
 */
export async function udpExchange(
  options: UdpExchangeOptions,
  dependencies: UdpTransportDependencies = NODE_DEPENDENCIES,
): Promise<UdpExchangeResult> {
  const result = await udpCollect(
    {
      ...options,
      maxDatagrams: 1,
      maxTotalResponseBytes: options.maxResponseBytes,
      isComplete: (): boolean => true,
    },
    dependencies,
  );
  const data = result.datagrams[0];
  if (data === undefined) {
    return fail("MALFORMED_RESPONSE");
  }
  return { data, rttMs: result.rttMs, address: result.address, port: result.port };
}

/**
 * Sends one datagram and collects bounded responses until the protocol reports completion.
 *
 * The callback sees immutable packet copies from only the selected pinned peer. It must remain
 * synchronous and should only inspect protocol framing; the transport owns all socket lifecycle.
 */
export function udpCollect(
  options: UdpCollectionOptions,
  dependencies: UdpTransportDependencies = NODE_DEPENDENCIES,
): Promise<UdpCollectionResult> {
  return new Promise((resolve, reject): void => {
    validateCollectionOptions(options);

    if (options.scope.signal.aborted) {
      reject(new UdpTransportError(terminationCode(options.scope)));
      return;
    }

    let socket: UdpSocketAdapter;
    try {
      socket = dependencies.createSocket(options.address.family);
    } catch {
      reject(new UdpTransportError("CONNECTION_FAILED"));
      return;
    }

    let closed = false;
    let settled = false;
    let unregisterCleanup = (): void => undefined;

    const closeSocket = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      try {
        socket.close();
      } catch {
        // Cleanup errors cannot replace the exchange outcome or prevent scope cleanup from running.
      }
    };

    const finish = (result: UdpCollectionResult | UdpTransportError): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.scope.signal.removeEventListener("abort", handleAbort);
      unregisterCleanup();
      closeSocket();

      if (result instanceof UdpTransportError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const handleAbort = (): void => {
      finish(new UdpTransportError(terminationCode(options.scope)));
    };

    socket.onError((): void => {
      finish(new UdpTransportError("CONNECTION_FAILED"));
    });

    const startedMs = dependencies.now();
    const datagrams: Uint8Array[] = [];
    let totalResponseBytes = 0;
    socket.onMessage((message, peer): void => {
      // Validate the peer before interpreting its size so an unrelated sender cannot fail a query.
      if (!peerMatches(peer, options.address, options.target.port)) {
        return;
      }
      if (peer.size !== message.byteLength || message.byteLength === 0) {
        finish(new UdpTransportError("MALFORMED_RESPONSE"));
        return;
      }
      if (message.byteLength > options.maxResponseBytes) {
        finish(new UdpTransportError("RESPONSE_TOO_LARGE"));
        return;
      }
      if (datagrams.length >= options.maxDatagrams) {
        finish(new UdpTransportError("RESPONSE_TOO_LARGE"));
        return;
      }

      totalResponseBytes += message.byteLength;
      if (totalResponseBytes > options.maxTotalResponseBytes) {
        finish(new UdpTransportError("RESPONSE_TOO_LARGE"));
        return;
      }

      datagrams.push(Uint8Array.from(message));
      let complete: boolean;
      try {
        complete = options.isComplete(datagrams);
      } catch {
        finish(new UdpTransportError("MALFORMED_RESPONSE"));
        return;
      }
      if (complete) {
        finish({
          datagrams: Object.freeze([...datagrams]),
          rttMs: Math.max(0, dependencies.now() - startedMs),
          address: options.address,
          port: options.target.port,
        });
      } else if (
        datagrams.length === options.maxDatagrams ||
        totalResponseBytes === options.maxTotalResponseBytes
      ) {
        // No additional non-empty datagram can fit, so waiting would only disguise a hard limit as a timeout.
        finish(new UdpTransportError("RESPONSE_TOO_LARGE"));
      }
    });

    options.scope.signal.addEventListener("abort", handleAbort, { once: true });
    unregisterCleanup = options.scope.addCleanup(closeSocket);

    try {
      socket.send(options.request, options.target.port, options.address.address, (error): void => {
        if (error !== undefined) {
          finish(new UdpTransportError("CONNECTION_FAILED"));
        }
      });
    } catch {
      finish(new UdpTransportError("CONNECTION_FAILED"));
    }
  });
}
