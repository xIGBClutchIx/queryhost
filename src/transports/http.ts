/** Bounded fixed-path HTTP exchanges over one validated, pinned destination. */

import { request as requestHttp, type ClientRequest, type IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import { isIP } from "node:net";

import type { ExecutionScope } from "../execution.js";
import { normalizeIpAddress } from "../ip.js";
import type { QueryErrorCode } from "../shared.js";
import type { IpFamily, PinnedAddress, PinnedTarget } from "../target.js";

const MAX_HTTP_RESPONSE_BYTES = 1_048_576;
const FIXED_PATH = /^\/[A-Za-z0-9._~-]+$/u;

/** HTTP failures that map directly into the stable public query contract. */
export type HttpTransportErrorCode = Extract<
  QueryErrorCode,
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TIMEOUT"
>;

const ERROR_MESSAGES: Readonly<Record<HttpTransportErrorCode, string>> = {
  ABORTED: "The HTTP exchange was cancelled.",
  CONNECTION_FAILED: "The HTTP exchange could not be completed.",
  INVALID_INPUT: "The HTTP exchange input is invalid.",
  MALFORMED_RESPONSE: "The HTTP response was malformed.",
  RESPONSE_TOO_LARGE: "The HTTP response exceeded its size limit.",
  TIMEOUT: "The HTTP exchange timed out.",
} as const;

/** Stable transport error that never exposes request implementation details. */
export class HttpTransportError extends Error {
  public override readonly name = "HttpTransportError";
  public readonly code: HttpTransportErrorCode;

  public constructor(code: HttpTransportErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

/** Request configuration passed to the injectable platform adapter. */
export interface HttpRequestConfiguration {
  readonly protocol: "http" | "https";
  readonly address: string;
  readonly family: IpFamily;
  readonly port: number;
  readonly path: string;
  readonly hostHeader: string;
  readonly servername?: string;
}

/** Minimal response boundary used by production networking and deterministic tests. */
export interface HttpResponseAdapter {
  readonly statusCode: number;
  readonly contentLength?: number;
  onData(listener: (data: Uint8Array) => void): void;
  onEnd(listener: () => void): void;
  onError(listener: (error: Error) => void): void;
  destroy(): void;
}

/** Minimal request boundary used by production networking and deterministic tests. */
export interface HttpRequestAdapter {
  onError(listener: (error: Error) => void): void;
  end(): void;
  destroy(): void;
}

/** Injectable request and monotonic-clock boundaries. */
export interface HttpTransportDependencies {
  createRequest(
    configuration: HttpRequestConfiguration,
    onResponse: (response: HttpResponseAdapter) => void,
  ): HttpRequestAdapter;
  now(): number;
}

/** Inputs for one GET request to a protocol-owned fixed path. */
export interface FixedHttpExchangeOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  readonly protocol: "http" | "https";
  readonly path: string;
  readonly maxResponseBytes: number;
}

/** Complete bounded HTTP response and transport measurements. */
export interface FixedHttpExchangeResult {
  readonly statusCode: number;
  readonly data: Uint8Array;
  readonly rttMs: number;
  readonly address: PinnedAddress;
  readonly port: number;
}

function parsedContentLength(response: IncomingMessage): number | undefined {
  const header = response.headers["content-length"];
  if (header === undefined || Array.isArray(header) || !/^\d+$/u.test(header)) {
    return undefined;
  }
  const value = Number(header);
  return Number.isSafeInteger(value) ? value : undefined;
}

function nodeResponse(response: IncomingMessage): HttpResponseAdapter {
  const contentLength = parsedContentLength(response);
  return {
    statusCode: response.statusCode ?? 0,
    ...(contentLength === undefined ? {} : { contentLength }),
    onData(listener): void {
      response.on("data", (chunk: Buffer): void => {
        listener(chunk);
      });
    },
    onEnd(listener): void {
      response.once("end", listener);
    },
    onError(listener): void {
      response.once("error", listener);
    },
    destroy(): void {
      response.destroy();
    },
  };
}

function nodeRequest(
  configuration: HttpRequestConfiguration,
  onResponse: (response: HttpResponseAdapter) => void,
): HttpRequestAdapter {
  const requestOptions = {
    method: "GET",
    hostname: configuration.address,
    family: configuration.family,
    port: configuration.port,
    path: configuration.path,
    headers: {
      Host: configuration.hostHeader,
      Accept: "application/json",
      "Accept-Encoding": "identity",
      Connection: "close",
    },
    ...(configuration.servername === undefined ? {} : { servername: configuration.servername }),
  } as const;
  const request: ClientRequest =
    configuration.protocol === "https"
      ? requestHttps(requestOptions, (response): void => {
          onResponse(nodeResponse(response));
        })
      : requestHttp(requestOptions, (response): void => {
          onResponse(nodeResponse(response));
        });
  return {
    onError(listener): void {
      request.once("error", listener);
    },
    end(): void {
      request.end();
    },
    destroy(): void {
      request.destroy();
    },
  };
}

const NODE_DEPENDENCIES: HttpTransportDependencies = {
  createRequest: nodeRequest,
  now: performance.now.bind(performance),
};

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

function validateOptions(options: FixedHttpExchangeOptions): void {
  if (
    !Number.isSafeInteger(options.target.port) ||
    options.target.port < 1 ||
    options.target.port > 65_535 ||
    !FIXED_PATH.test(options.path) ||
    !Number.isSafeInteger(options.maxResponseBytes) ||
    options.maxResponseBytes < 1 ||
    options.maxResponseBytes > MAX_HTTP_RESPONSE_BYTES ||
    !options.target.addresses.some((address) => addressesMatch(address, options.address))
  ) {
    throw new HttpTransportError("INVALID_INPUT");
  }
}

function hostHeader(target: PinnedTarget, protocol: "http" | "https"): string {
  const hostname = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
  const defaultPort = protocol === "http" ? 80 : 443;
  return target.port === defaultPort ? hostname : `${hostname}:${String(target.port)}`;
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

function terminationCode(scope: ExecutionScope): HttpTransportErrorCode {
  return scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED";
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Performs one non-redirecting GET against a pinned address and bounded response body. */
export function fixedHttpExchange(
  options: FixedHttpExchangeOptions,
  dependencies: HttpTransportDependencies = NODE_DEPENDENCIES,
): Promise<FixedHttpExchangeResult> {
  return new Promise((resolve, reject): void => {
    validateOptions(options);
    if (options.scope.signal.aborted) {
      reject(new HttpTransportError(terminationCode(options.scope)));
      return;
    }

    let request: HttpRequestAdapter | undefined;
    let response: HttpResponseAdapter | undefined;
    let settled = false;
    let cleaned = false;
    let unregisterCleanup = (): void => undefined;
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const startedMs = dependencies.now();

    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      try {
        response?.destroy();
      } catch {
        // Cleanup errors cannot replace the exchange outcome.
      }
      try {
        request?.destroy();
      } catch {
        // Cleanup errors cannot replace the exchange outcome.
      }
    };
    const finish = (result: FixedHttpExchangeResult | HttpTransportError): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.scope.signal.removeEventListener("abort", handleAbort);
      unregisterCleanup();
      cleanup();
      if (result instanceof HttpTransportError) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const handleAbort = (): void => {
      finish(new HttpTransportError(terminationCode(options.scope)));
    };
    const handleResponse = (incoming: HttpResponseAdapter): void => {
      response = incoming;
      if (
        incoming.statusCode < 100 ||
        incoming.statusCode > 599 ||
        (incoming.contentLength !== undefined && incoming.contentLength > options.maxResponseBytes)
      ) {
        finish(
          new HttpTransportError(
            incoming.contentLength !== undefined &&
              incoming.contentLength > options.maxResponseBytes
              ? "RESPONSE_TOO_LARGE"
              : "MALFORMED_RESPONSE",
          ),
        );
        return;
      }
      incoming.onData((data): void => {
        totalBytes += data.byteLength;
        if (totalBytes > options.maxResponseBytes) {
          finish(new HttpTransportError("RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(Uint8Array.from(data));
      });
      incoming.onEnd((): void => {
        if (incoming.contentLength !== undefined && incoming.contentLength !== totalBytes) {
          finish(new HttpTransportError("MALFORMED_RESPONSE"));
          return;
        }
        finish({
          statusCode: incoming.statusCode,
          data: mergedBytes(chunks, totalBytes),
          rttMs: Math.max(0, dependencies.now() - startedMs),
          address: options.address,
          port: options.target.port,
        });
      });
      incoming.onError((): void => {
        finish(new HttpTransportError("CONNECTION_FAILED"));
      });
    };

    const configuration: HttpRequestConfiguration = {
      protocol: options.protocol,
      address: options.address.address,
      family: options.address.family,
      port: options.target.port,
      path: options.path,
      hostHeader: hostHeader(options.target, options.protocol),
      ...(options.protocol === "https" && isIP(options.target.hostname) === 0
        ? { servername: options.target.hostname }
        : {}),
    };
    try {
      request = dependencies.createRequest(configuration, handleResponse);
    } catch {
      reject(new HttpTransportError("CONNECTION_FAILED"));
      return;
    }
    request.onError((): void => {
      finish(new HttpTransportError("CONNECTION_FAILED"));
    });
    options.scope.signal.addEventListener("abort", handleAbort, { once: true });
    unregisterCleanup = options.scope.addCleanup(cleanup);
    if (isAborted(options.scope.signal)) {
      handleAbort();
      return;
    }
    try {
      request.end();
    } catch {
      finish(new HttpTransportError("CONNECTION_FAILED"));
    }
  });
}
