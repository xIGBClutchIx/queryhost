import http from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";

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

  it("bypasses host-installed global agents that could reroute the pinned address", async (): Promise<void> => {
    let agentConnections = 0;
    const trap = (): Duplex => {
      agentConnections += 1;
      throw new Error("The global agent must not carry pinned exchanges.");
    };
    class ReroutingHttpAgent extends http.Agent {
      public override createConnection(): Duplex {
        return trap();
      }
    }
    class ReroutingHttpsAgent extends https.Agent {
      public override createConnection(): Duplex {
        return trap();
      }
    }
    let receivedRequests = 0;
    const fake = await startFakeHttpServer((_request, response): void => {
      receivedRequests += 1;
      response.end("{}");
    });
    const selected = target(fake.port);
    const exchange = async (protocol: "http" | "https"): Promise<number> => {
      const scope = createExecutionContext({ timeoutMs: 500 });
      try {
        const result = await fixedHttpExchange({
          scope,
          target: selected,
          address: firstAddress(selected),
          protocol,
          path: "/info.json",
          maxResponseBytes: 64,
        });
        return result.statusCode;
      } finally {
        scope.close();
      }
    };
    const originalHttpAgent = http.globalAgent;
    const originalHttpsAgent = https.globalAgent;
    http.globalAgent = new ReroutingHttpAgent();
    https.globalAgent = new ReroutingHttpsAgent();
    try {
      await expect(exchange("http")).resolves.toBe(200);
      // The plaintext server cannot complete a TLS handshake, but the socket must be ours.
      await expect(exchange("https")).rejects.toSatisfy(transportCode("CONNECTION_FAILED"));
    } finally {
      http.globalAgent = originalHttpAgent;
      https.globalAgent = originalHttpsAgent;
    }

    expect(agentConnections).toBe(0);
    expect(receivedRequests).toBe(1);
  });

  it("sends bounded POST bodies to multi-segment fixed paths", async (): Promise<void> => {
    let receivedMethod: string | undefined;
    let receivedContentType: string | undefined;
    let receivedBody = "";
    const fake = await startFakeHttpServer((request, response): void => {
      receivedMethod = request.method;
      receivedContentType = request.headers["content-type"];
      request.setEncoding("utf8");
      request.on("data", (chunk: string): void => {
        receivedBody += chunk;
      });
      request.on("end", (): void => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      });
    });
    const selected = target(fake.port);
    const scope = createExecutionContext({ timeoutMs: 500 });
    await fixedHttpExchange({
      scope,
      target: selected,
      address: firstAddress(selected),
      protocol: "http",
      path: "/api/v1",
      maxResponseBytes: 64,
      method: "POST",
      body: new TextEncoder().encode('{"function":"HealthCheck"}'),
      contentType: "application/json",
    });
    scope.close();

    expect(receivedMethod).toBe("POST");
    expect(receivedContentType).toBe("application/json");
    expect(receivedBody).toBe('{"function":"HealthCheck"}');
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
      method: "GET",
      address: "127.0.0.1",
      hostHeader: "play.example.com",
      servername: "play.example.com",
      rejectUnauthorized: true,
    });
  });

  it("passes bounded POST data and an explicit TLS certificate policy", async (): Promise<void> => {
    let configuration: HttpRequestConfiguration | undefined;
    const dependencies: HttpTransportDependencies = {
      createRequest(value, onResponse): HttpRequestAdapter {
        configuration = value;
        return {
          onError(): void {},
          end(): void {
            onResponse({
              statusCode: 200,
              contentLength: 2,
              onData(listener): void {
                listener(new TextEncoder().encode("{}"));
              },
              onEnd(listener): void {
                listener();
              },
              onError(): void {},
              destroy(): void {},
            });
          },
          destroy(): void {},
        };
      },
      now: (): number => 0,
    };
    const selected = target(7777);
    const body = new TextEncoder().encode('{"function":"HealthCheck"}');
    const scope = createExecutionContext({ timeoutMs: 500 });
    await fixedHttpExchange(
      {
        scope,
        target: selected,
        address: firstAddress(selected),
        protocol: "https",
        path: "/api/v1",
        maxResponseBytes: 64,
        method: "POST",
        body,
        contentType: "application/json",
        tlsCertificatePolicy: "disabled",
      },
      dependencies,
    );
    scope.close();

    expect(configuration).toMatchObject({
      method: "POST",
      body,
      contentType: "application/json",
      rejectUnauthorized: false,
    });
  });
});
