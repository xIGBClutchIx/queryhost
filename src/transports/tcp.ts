/** Bounded TCP request/response exchanges over one validated, pinned destination. */

import { isIP, Socket } from "node:net";

import type { ExecutionScope } from "../execution.js";
import { normalizeIpAddress } from "../ip.js";
import type { QueryErrorCode } from "../shared.js";
import type { IpFamily, PinnedAddress, PinnedTarget } from "../target.js";

const MAX_TCP_EXCHANGE_BYTES = 1_048_576;

/** TCP failures that map directly into the stable public query contract. */
export type TcpTransportErrorCode = Extract<
  QueryErrorCode,
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
>;

const ERROR_MESSAGES: Readonly<Record<TcpTransportErrorCode, string>> = {
  ABORTED: "The TCP exchange was cancelled.",
  CONNECTION_FAILED: "The TCP exchange could not be completed.",
  INVALID_INPUT: "The TCP exchange input is invalid.",
  MALFORMED_RESPONSE: "The TCP response was malformed.",
  RESPONSE_TOO_LARGE: "The TCP response exceeded its size limit.",
  TIMEOUT: "The TCP exchange timed out.",
} as const;

/** Stable transport error that never exposes socket implementation details. */
export class TcpTransportError extends Error {
  public override readonly name = "TcpTransportError";
  public readonly code: TcpTransportErrorCode;

  public constructor(code: TcpTransportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Protocol-owned assessment of the bytes accumulated so far. */
export type TcpResponseState = "complete" | "incomplete" | "malformed" | "too-large";

/** Minimal socket boundary used by production networking and deterministic fault tests. */
export interface TcpSocketAdapter {
  onConnect(listener: () => void): void;
  onData(listener: (data: Uint8Array) => void): void;
  onEnd(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
  connect(port: number, address: string, family: IpFamily): void;
  write(data: Uint8Array, completion: (error: Error | undefined) => void): void;
  destroy(): void;
}

/** Injectable socket and clock boundaries for deterministic transport tests. */
export interface TcpTransportDependencies {
  createSocket(): TcpSocketAdapter;
  now(): number;
}

/** Inputs for one bounded TCP request followed by one protocol-framed response. */
export interface TcpExchangeOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  /** One address selected from `target.addresses`; this transport never resolves DNS. */
  readonly address: PinnedAddress;
  readonly request: Uint8Array;
  /** Maximum combined response bytes accepted from 1 through 1 MiB. */
  readonly maxResponseBytes: number;
  /** Synchronous framing check over immutable bytes from the selected connection. */
  readonly inspectResponse: (data: Uint8Array) => TcpResponseState;
}

/** Complete bounded response and transport measurements. */
export interface TcpExchangeResult {
  readonly data: Uint8Array;
  readonly rttMs: number;
  readonly address: PinnedAddress;
  readonly port: number;
}

function createNodeSocketAdapter(): TcpSocketAdapter {
  const socket = new Socket({ allowHalfOpen: false });
  socket.setNoDelay(true);
  return {
    onConnect(listener): void {
      socket.once("connect", listener);
    },
    onData(listener): void {
      socket.on("data", listener);
    },
    onEnd(listener): void {
      socket.once("end", listener);
    },
    onError(listener): void {
      socket.once("error", listener);
    },
    connect(port, address, family): void {
      socket.connect({ port, host: address, family });
    },
    write(data, completion): void {
      socket.write(data, (error): void => {
        completion(error ?? undefined);
      });
    },
    destroy(): void {
      socket.destroy();
    },
  };
}

const NODE_DEPENDENCIES: TcpTransportDependencies = {
  createSocket: createNodeSocketAdapter,
  now: performance.now.bind(performance),
};

function fail(code: TcpTransportErrorCode): never {
  throw new TcpTransportError(code);
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

function validateOptions(options: TcpExchangeOptions): void {
  if (
    !Number.isSafeInteger(options.target.port) ||
    options.target.port < 1 ||
    options.target.port > 65_535 ||
    options.request.byteLength < 1 ||
    options.request.byteLength > MAX_TCP_EXCHANGE_BYTES ||
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes < 1 ||
    options.maxResponseBytes > MAX_TCP_EXCHANGE_BYTES ||
    !options.target.addresses.some((address) => addressesMatch(address, options.address))
  ) {
    fail("INVALID_INPUT");
  }
}

function terminationCode(scope: ExecutionScope): TcpTransportErrorCode {
  return scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED";
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function mergedBytes(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/**
 * Connects to one pinned address, writes one request, and accumulates a protocol-framed response.
 *
 * The protocol owns framing through `inspectResponse`; the transport owns byte limits, deadline
 * propagation, socket errors, and exactly-once cleanup. The caller retains ownership of the scope.
 */
export function tcpExchange(
  options: TcpExchangeOptions,
  dependencies: TcpTransportDependencies = NODE_DEPENDENCIES,
): Promise<TcpExchangeResult> {
  return new Promise((resolve, reject): void => {
    validateOptions(options);
    if (options.scope.signal.aborted) {
      reject(new TcpTransportError(terminationCode(options.scope)));
      return;
    }

    let socket: TcpSocketAdapter;
    try {
      socket = dependencies.createSocket();
    } catch {
      reject(new TcpTransportError("CONNECTION_FAILED"));
      return;
    }

    let destroyed = false;
    let settled = false;
    let unregisterCleanup = (): void => undefined;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    const destroySocket = (): void => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      try {
        socket.destroy();
      } catch {
        // Cleanup errors cannot replace the exchange outcome.
      }
    };

    const finish = (result: TcpExchangeResult | TcpTransportError): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.scope.signal.removeEventListener("abort", handleAbort);
      unregisterCleanup();
      destroySocket();
      if (result instanceof TcpTransportError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const handleAbort = (): void => {
      finish(new TcpTransportError(terminationCode(options.scope)));
    };

    const startedMs = dependencies.now();
    socket.onConnect((): void => {
      try {
        socket.write(options.request, (error): void => {
          if (error !== undefined) {
            finish(new TcpTransportError("CONNECTION_FAILED"));
          }
        });
      } catch {
        finish(new TcpTransportError("CONNECTION_FAILED"));
      }
    });
    socket.onData((data): void => {
      if (data.byteLength === 0) {
        finish(new TcpTransportError("MALFORMED_RESPONSE"));
        return;
      }
      totalBytes += data.byteLength;
      if (totalBytes > options.maxResponseBytes) {
        finish(new TcpTransportError("RESPONSE_TOO_LARGE"));
        return;
      }
      chunks.push(Uint8Array.from(data));
      const response = mergedBytes(chunks, totalBytes);
      let state: TcpResponseState;
      try {
        state = options.inspectResponse(Uint8Array.from(response));
      } catch {
        state = "malformed";
      }
      if (state === "malformed") {
        finish(new TcpTransportError("MALFORMED_RESPONSE"));
      } else if (state === "too-large") {
        finish(new TcpTransportError("RESPONSE_TOO_LARGE"));
      } else if (state === "complete") {
        finish({
          data: response,
          rttMs: Math.max(0, dependencies.now() - startedMs),
          address: options.address,
          port: options.target.port,
        });
      } else if (totalBytes === options.maxResponseBytes) {
        finish(new TcpTransportError("RESPONSE_TOO_LARGE"));
      }
    });
    socket.onEnd((): void => {
      finish(new TcpTransportError("MALFORMED_RESPONSE"));
    });
    socket.onError((): void => {
      finish(new TcpTransportError("CONNECTION_FAILED"));
    });

    options.scope.signal.addEventListener("abort", handleAbort, { once: true });
    unregisterCleanup = options.scope.addCleanup(destroySocket);
    // Close the small race between the initial check and abort-listener registration.
    if (isAborted(options.scope.signal)) {
      handleAbort();
      return;
    }
    try {
      socket.connect(options.target.port, options.address.address, options.address.family);
    } catch {
      finish(new TcpTransportError("CONNECTION_FAILED"));
    }
  });
}
