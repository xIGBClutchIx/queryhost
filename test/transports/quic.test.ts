import { createSocket } from "node:dgram";

import { afterEach, describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../src/network/target.js";
import { createExecutionContext, type ExecutionScope } from "../../src/runtime/execution.js";
import {
  quicExchange,
  QuicTransportError,
  type QuicExchangeOptions,
  type QuicResponseState,
} from "../../src/transports/quic.js";
import {
  startFakeQuicServer,
  stopAllFakeQuicServers,
  type FakeQuicBehavior,
  type FakeQuicServer,
} from "../helpers/fake-quic-server.js";

const LOOPBACK: PinnedAddress = Object.freeze({ address: "127.0.0.1", family: 4 });
const REQUEST = new TextEncoder().encode("status?");

function target(port: number): PinnedTarget {
  return Object.freeze({
    hostname: "play.example.com",
    port,
    addresses: Object.freeze([LOOPBACK]),
  });
}

/** Length-prefixed framing, like the protocols this transport serves. */
function framed(body: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + body.byteLength);
  new DataView(result.buffer).setUint32(0, body.byteLength);
  result.set(body, 4);
  return result;
}

function inspectFramed(data: Uint8Array): QuicResponseState {
  if (data.byteLength < 4) {
    return "incomplete";
  }
  const length = new DataView(data.buffer, data.byteOffset).getUint32(0);
  const available = data.byteLength - 4;
  return available < length ? "incomplete" : available === length ? "complete" : "malformed";
}

function options(
  server: FakeQuicServer,
  scope: ExecutionScope,
  overrides: Partial<QuicExchangeOptions> = {},
): QuicExchangeOptions {
  return {
    scope,
    target: target(server.port),
    address: LOOPBACK,
    serverName: "reclaimer",
    tlsCertificatePolicy: "disabled",
    request: REQUEST,
    maxResponseBytes: 65_536,
    inspectResponse: inspectFramed,
    ...overrides,
  };
}

function expectCode(code: QuicTransportError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof QuicTransportError && error.code === code;
}

async function exchange(
  behavior: FakeQuicBehavior,
  overrides: Partial<QuicExchangeOptions> = {},
  timeoutMs = 2_000,
): Promise<{ readonly server: FakeQuicServer; readonly result: Promise<Uint8Array> }> {
  const server = await startFakeQuicServer(behavior);
  const scope = createExecutionContext({ timeoutMs });
  const result = quicExchange(options(server, scope, overrides))
    .then((value) => value.data)
    .finally(() => {
      scope.close();
    });
  return { server, result };
}

afterEach(async (): Promise<void> => {
  await stopAllFakeQuicServers();
});

describe("QUIC transport", (): void => {
  it("completes a TLS 1.3 handshake and returns the stream response", async (): Promise<void> => {
    const body = framed(new TextEncoder().encode('{"ok":true}'));
    const { server, result } = await exchange({ respond: () => body });

    expect(await result).toEqual(body);
    expect(server.requests).toEqual([REQUEST]);
    expect(server.serverNames).toEqual(["reclaimer"]);
    expect(server.offeredAlpn).toEqual([[]]);
    expect(server.clientFinishedValid()).toBe(true);
  });

  it("reassembles a response split across reordered packets", async (): Promise<void> => {
    const body = framed(new Uint8Array(4_000).map((_, index) => index % 251));
    const { result } = await exchange({
      respond: () => body,
      chunkBytes: 700,
      reverseChunks: true,
    });

    expect(await result).toEqual(body);
  });

  it("closes the connection after a successful exchange", async (): Promise<void> => {
    const { server, result } = await exchange({ respond: () => framed(Uint8Array.of(1)) });
    await result;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(server.closeReceived()).toBe(true);
  });

  it("follows one authenticated Retry", async (): Promise<void> => {
    const body = framed(Uint8Array.of(7));
    const { server, result } = await exchange({ retry: true, respond: () => body });

    expect(await result).toEqual(body);
    expect(server.requests).toHaveLength(1);
  });

  it("offers and accepts the protocol's ALPN", async (): Promise<void> => {
    const body = framed(Uint8Array.of(1));
    const { server, result } = await exchange(
      { alpn: "status/1", respond: () => body },
      { alpn: ["status/1"] },
    );

    expect(await result).toEqual(body);
    expect(server.offeredAlpn).toEqual([["status/1"]]);
  });

  it("fails when the server selects no offered ALPN", async (): Promise<void> => {
    const { result } = await exchange({}, { alpn: ["status/1"] });

    await expect(result).rejects.toSatisfy(expectCode("CONNECTION_FAILED"));
  });

  it("probes again when the first flight is lost", async (): Promise<void> => {
    const body = framed(Uint8Array.of(9));
    const { server, result } = await exchange({ dropFirstDatagrams: 1, respond: () => body });

    expect(await result).toEqual(body);
    expect(server.datagrams()).toBeGreaterThanOrEqual(2);
  });

  it("fails when the server only offers other versions", async (): Promise<void> => {
    const { result } = await exchange({ versionNegotiation: true });

    await expect(result).rejects.toSatisfy(expectCode("CONNECTION_FAILED"));
  });

  it("rejects a server Finished that does not authenticate the transcript", async (): Promise<void> => {
    const { server, result } = await exchange({ corruptFinished: true });

    await expect(result).rejects.toSatisfy(expectCode("CONNECTION_FAILED"));
    expect(server.requests).toEqual([]);
  });

  it("rejects transport parameters that do not echo the client's connection ID", async (): Promise<void> => {
    const { server, result } = await exchange({ wrongOriginalDestination: true });

    await expect(result).rejects.toSatisfy(expectCode("CONNECTION_FAILED"));
    expect(server.requests).toEqual([]);
  });

  it("reports a server CONNECTION_CLOSE as a connection failure", async (): Promise<void> => {
    const { result } = await exchange({ closeInsteadOfResponding: true });

    await expect(result).rejects.toSatisfy(expectCode("CONNECTION_FAILED"));
  });

  it("rejects a stream that ends before its framing is complete", async (): Promise<void> => {
    const { result } = await exchange({ respond: () => framed(new Uint8Array(10)).subarray(0, 8) });

    await expect(result).rejects.toSatisfy(expectCode("MALFORMED_RESPONSE"));
  });

  it("rejects an empty response stream", async (): Promise<void> => {
    const { result } = await exchange({ respond: () => new Uint8Array(0) });

    await expect(result).rejects.toSatisfy(expectCode("MALFORMED_RESPONSE"));
  });

  it("stops at the response limit", async (): Promise<void> => {
    const { result } = await exchange(
      { respond: () => framed(new Uint8Array(2_000)) },
      { maxResponseBytes: 1_000 },
    );

    await expect(result).rejects.toSatisfy(expectCode("RESPONSE_TOO_LARGE"));
  });

  it("times out against a silent server after bounded probes", async (): Promise<void> => {
    const { server, result } = await exchange({ silent: true }, {}, 1_500);

    await expect(result).rejects.toSatisfy(expectCode("TIMEOUT"));
    // The first Initial plus probes at 400 ms and 1,200 ms.
    expect(server.datagrams()).toBe(3);
  });

  it("ignores datagrams from any other peer", async (): Promise<void> => {
    const body = framed(Uint8Array.of(3));
    const server = await startFakeQuicServer({ respond: () => body });
    const intruder = createSocket("udp4");
    const scope = createExecutionContext({ timeoutMs: 2_000 });
    let clientPort: number | undefined;
    const dependencies = {
      createSocket: (family: 4 | 6) => {
        const socket = createSocket(family === 4 ? "udp4" : "udp6");
        return {
          onMessage(
            listener: (
              message: Uint8Array,
              peer: { address: string; port: number; size: number },
            ) => void,
          ): void {
            socket.on("message", (message, remote) => {
              listener(message, { address: remote.address, port: remote.port, size: remote.size });
            });
          },
          onError(listener: (error: Error) => void): void {
            socket.on("error", listener);
          },
          connect(port: number, address: string, connected: () => void): void {
            socket.connect(port, address, () => {
              clientPort = socket.address().port;
              connected();
            });
          },
          send(message: Uint8Array, completion: (error: Error | undefined) => void): void {
            if (clientPort !== undefined) {
              intruder.send(Uint8Array.of(0xc0, 0, 0, 0, 1), clientPort, "127.0.0.1");
            }
            socket.send(message, (error) => {
              completion(error ?? undefined);
            });
          },
          close(): void {
            socket.close();
          },
        };
      },
      now: () => performance.now(),
      randomBytes: (length: number) =>
        new Uint8Array(length).map(() => Math.floor(Math.random() * 256)),
      schedule: (callback: () => void, delayMs: number) => {
        const timer = setTimeout(callback, delayMs);
        return () => {
          clearTimeout(timer);
        };
      },
    };
    try {
      const result = await quicExchange(options(server, scope), dependencies);
      expect(result.data).toEqual(body);
    } finally {
      scope.close();
      intruder.close();
    }
  });

  it.each([
    ["an empty request", { request: new Uint8Array(0) }],
    ["an oversized request", { request: new Uint8Array(1_025) }],
    ["a response limit above 1 MiB", { maxResponseBytes: 1_048_577 }],
    ["an address outside the target", { address: { address: "127.0.0.2", family: 4 } as const }],
  ])("rejects %s", async (_name, overrides): Promise<void> => {
    const server = await startFakeQuicServer();
    const scope = createExecutionContext({ timeoutMs: 1_000 });
    try {
      await expect(quicExchange(options(server, scope, overrides))).rejects.toSatisfy(
        expectCode("INVALID_INPUT"),
      );
      expect(server.datagrams()).toBe(0);
    } finally {
      scope.close();
    }
  });

  it("does not start after cancellation", async (): Promise<void> => {
    const server = await startFakeQuicServer();
    const controller = new AbortController();
    controller.abort();
    const scope = createExecutionContext({ timeoutMs: 1_000, signal: controller.signal });

    await expect(quicExchange(options(server, scope))).rejects.toSatisfy(expectCode("ABORTED"));
    expect(server.datagrams()).toBe(0);
  });

  it("stops promptly when cancelled mid-handshake", async (): Promise<void> => {
    const server = await startFakeQuicServer({ silent: true });
    const controller = new AbortController();
    const scope = createExecutionContext({ timeoutMs: 5_000, signal: controller.signal });
    const result = quicExchange(options(server, scope));
    setTimeout(() => {
      controller.abort();
    }, 50);

    await expect(result).rejects.toSatisfy(expectCode("ABORTED"));
    expect(server.datagrams()).toBe(1);
  });
});
