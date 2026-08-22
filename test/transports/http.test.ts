import { afterEach, describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../src/network/target.js";
import { createExecutionContext } from "../../src/runtime/execution.js";
import {
  fixedHttpExchange,
  HttpTransportError,
  type HttpRequestAdapter,
  type HttpRequestConfiguration,
  type HttpResponseAdapter,
  type HttpTransportDependencies,
} from "../../src/transports/http.js";
import { startFakeHttpServer, stopAllFakeHttpServers } from "../helpers/fake-http-server.js";

function target(port: number, hostname = "play.example.com"): PinnedTarget {
  return Object.freeze({
    hostname,
    port,
    addresses: Object.freeze([Object.freeze({ address: "127.0.0.1", family: 4 })]),
  });
}

function firstAddress(selected: PinnedTarget): PinnedAddress {
  const address = selected.addresses[0];
  if (address === undefined) {
    throw new Error("The test target is missing its pinned address.");
  }
  return address;
}

function transportCode(code: HttpTransportError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof HttpTransportError && error.code === code;
}

afterEach(stopAllFakeHttpServers);

describe("fixed-path HTTP transport", (): void => {
  it("connects to the pinned address while preserving the original Host header", async (): Promise<void> => {
    let receivedHost: string | undefined;
    let receivedPath: string | undefined;
    const fake = await startFakeHttpServer((request, response): void => {
      receivedHost = request.headers.host;
      receivedPath = request.url;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"ok":');
      response.end("true}");
    });
    const selected = target(fake.port);
    const scope = createExecutionContext({ timeoutMs: 500 });
    const result = await fixedHttpExchange({
      scope,
      target: selected,
      address: firstAddress(selected),
      protocol: "http",
      path: "/info.json",
      maxResponseBytes: 64,
    });
    scope.close();

    expect(new TextDecoder().decode(result.data)).toBe('{"ok":true}');
    expect(receivedHost).toBe(`play.example.com:${String(fake.port)}`);
    expect(receivedPath).toBe("/info.json");
  });

  it("returns redirects without contacting their destination", async (): Promise<void> => {
    let redirectedRequests = 0;
    const destination = await startFakeHttpServer((_request, response): void => {
      redirectedRequests += 1;
      response.end("unexpected");
    });
    const origin = await startFakeHttpServer((_request, response): void => {
      response.writeHead(302, {
        Location: `http://127.0.0.1:${String(destination.port)}/players.json`,
      });
      response.end();
    });
    const selected = target(origin.port);
    const scope = createExecutionContext({ timeoutMs: 500 });
    const result = await fixedHttpExchange({
      scope,
      target: selected,
      address: firstAddress(selected),
      protocol: "http",
      path: "/players.json",
      maxResponseBytes: 64,
    });
    scope.close();

    expect(result.statusCode).toBe(302);
    expect(redirectedRequests).toBe(0);
  });

  it("enforces declared, streamed, and mismatched body lengths", async (): Promise<void> => {
    const declared = await startFakeHttpServer((_request, response): void => {
      response.writeHead(200, { "Content-Length": "100" });
      response.end("small");
    });
    const declaredTarget = target(declared.port);
    const declaredScope = createExecutionContext({ timeoutMs: 500 });
    await expect(
      fixedHttpExchange({
        scope: declaredScope,
        target: declaredTarget,
        address: firstAddress(declaredTarget),
        protocol: "http",
        path: "/info.json",
        maxResponseBytes: 8,
      }),
    ).rejects.toSatisfy(transportCode("RESPONSE_TOO_LARGE"));
    declaredScope.close();

    const streamed = await startFakeHttpServer((_request, response): void => {
      response.writeHead(200);
      response.write("12345");
      response.end("67890");
    });
    const streamedTarget = target(streamed.port);
    const streamedScope = createExecutionContext({ timeoutMs: 500 });
    await expect(
      fixedHttpExchange({
        scope: streamedScope,
        target: streamedTarget,
        address: firstAddress(streamedTarget),
        protocol: "http",
        path: "/info.json",
        maxResponseBytes: 8,
      }),
    ).rejects.toSatisfy(transportCode("RESPONSE_TOO_LARGE"));
    streamedScope.close();

    const mismatchResponse: HttpResponseAdapter = {
      statusCode: 200,
      contentLength: 4,
      onData(listener): void {
        listener(Uint8Array.of(1, 2));
      },
      onEnd(listener): void {
        listener();
      },
      onError(): void {
        // This deterministic response never emits an error.
      },
      destroy(): void {
        // No platform resource is owned by this deterministic adapter.
      },
    };
    const mismatchDependencies: HttpTransportDependencies = {
      createRequest(_configuration, onResponse): HttpRequestAdapter {
        return {
          onError(): void {
            // This deterministic request never emits an error.
          },
          end(): void {
            onResponse(mismatchResponse);
          },
          destroy(): void {
            // No platform resource is owned by this deterministic adapter.
          },
        };
      },
      now: (): number => 0,
    };
    const mismatchTarget = target(30120);
    const mismatchScope = createExecutionContext({ timeoutMs: 500 });
    await expect(
      fixedHttpExchange(
        {
          scope: mismatchScope,
          target: mismatchTarget,
          address: firstAddress(mismatchTarget),
          protocol: "http",
          path: "/info.json",
          maxResponseBytes: 8,
        },
        mismatchDependencies,
      ),
    ).rejects.toSatisfy(transportCode("MALFORMED_RESPONSE"));
    mismatchScope.close();
  });

  it("times out stalled responses and rejects URL-like paths", async (): Promise<void> => {
    const fake = await startFakeHttpServer((): void => undefined);
    const selected = target(fake.port);
    const scope = createExecutionContext({ timeoutMs: 25 });
    await expect(
      fixedHttpExchange({
        scope,
        target: selected,
        address: firstAddress(selected),
        protocol: "http",
        path: "/dynamic.json",
        maxResponseBytes: 64,
      }),
    ).rejects.toSatisfy(transportCode("TIMEOUT"));
    scope.close();

    const invalidScope = createExecutionContext({ timeoutMs: 500 });
    await expect(
      fixedHttpExchange({
        scope: invalidScope,
        target: selected,
        address: firstAddress(selected),
        protocol: "http",
        path: "//evil.example/info.json",
        maxResponseBytes: 64,
      }),
    ).rejects.toSatisfy(transportCode("INVALID_INPUT"));
    invalidScope.close();
  });

  it("configures TLS SNI from the original hostname, not the pinned IP", async (): Promise<void> => {
    let configuration: HttpRequestConfiguration | undefined;
    const response: HttpResponseAdapter = {
      statusCode: 200,
      contentLength: 2,
      onData(listener): void {
        listener(new TextEncoder().encode("{}"));
      },
      onEnd(listener): void {
        listener();
      },
      onError(): void {
        // This deterministic response never emits an error.
      },
      destroy(): void {
        // No platform resource is owned by this deterministic adapter.
      },
    };
    const dependencies: HttpTransportDependencies = {
      createRequest(value, onResponse): HttpRequestAdapter {
        configuration = value;
        return {
          onError(): void {
            // This deterministic request never emits an error.
          },
          end(): void {
            onResponse(response);
          },
          destroy(): void {
            // No platform resource is owned by this deterministic adapter.
          },
        };
      },
      now: (): number => 10,
    };
    const selected = target(443);
    const scope = createExecutionContext({ timeoutMs: 500 });
    await fixedHttpExchange(
      {
        scope,
        target: selected,
        address: firstAddress(selected),
        protocol: "https",
        path: "/info.json",
        maxResponseBytes: 64,
      },
      dependencies,
    );
    scope.close();

    expect(configuration).toMatchObject({
      address: "127.0.0.1",
      hostHeader: "play.example.com",
      servername: "play.example.com",
    });
  });
});
