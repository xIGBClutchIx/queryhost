import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../src/network/target.js";
import { createExecutionContext, type ExecutionScope } from "../../src/runtime/execution.js";
import {
  tcpExchange,
  TcpTransportError,
  type TcpResponseState,
  type TcpSocketAdapter,
  type TcpTransportDependencies,
} from "../../src/transports/tcp.js";

const servers: Server[] = [];
const serverSockets = new Map<Server, Set<Socket>>();

async function fakeServer(
  handler: (socket: Socket) => void,
): Promise<{ server: Server; port: number }> {
  const server = createServer();
  const sockets = new Set<Socket>();
  serverSockets.set(server, sockets);
  server.on("connection", (socket): void => {
    sockets.add(socket);
    socket.once("close", (): void => {
      sockets.delete(socket);
    });
    handler(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve, reject): void => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", (): void => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The fake TCP server did not expose an IP port.");
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  const sockets = serverSockets.get(server);
  if (sockets !== undefined) {
    for (const socket of sockets) {
      socket.destroy();
    }
  }
  await new Promise<void>((resolve, reject): void => {
    server.close((error): void => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
  serverSockets.delete(server);
}

function target(port: number): PinnedTarget {
  return Object.freeze({
    hostname: "fake.example",
    port,
    addresses: Object.freeze([Object.freeze({ address: "127.0.0.1", family: 4 })]),
  });
}

function lineState(data: Uint8Array): "complete" | "incomplete" {
  return data.includes(0x0a) ? "complete" : "incomplete";
}

function firstAddress(selected: PinnedTarget): PinnedAddress {
  const address = selected.addresses[0];
  if (address === undefined) {
    throw new Error("The test target is missing its pinned address.");
  }
  return address;
}

function exchange(scope: ExecutionScope, port: number, maxResponseBytes = 64): Promise<Uint8Array> {
  const selected = target(port);
  return tcpExchange({
    scope,
    target: selected,
    address: firstAddress(selected),
    request: new TextEncoder().encode("ping\n"),
    maxResponseBytes,
    inspectResponse: lineState,
  }).then((result) => result.data);
}

function transportCode(code: TcpTransportError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof TcpTransportError && error.code === code;
}

afterEach(async (): Promise<void> => {
  const active = servers.splice(0);
  await Promise.all(active.map(closeServer));
});

describe("bounded TCP transport", (): void => {
  it("reconstructs a response fragmented across delayed reads", async (): Promise<void> => {
    const { port } = await fakeServer((socket): void => {
      socket.once("data", (): void => {
        socket.write("hel");
        setTimeout((): void => {
          socket.write("lo\n");
        }, 5);
      });
    });
    const scope = createExecutionContext({ timeoutMs: 500 });
    await expect(exchange(scope, port)).resolves.toEqual(new TextEncoder().encode("hello\n"));
    scope.close();
  });

  it("times out a server that accepts the request but reads too slowly", async (): Promise<void> => {
    const { port } = await fakeServer((socket): void => {
      socket.once("data", (): void => undefined);
    });
    const scope = createExecutionContext({ timeoutMs: 25 });
    await expect(exchange(scope, port)).rejects.toSatisfy(transportCode("TIMEOUT"));
    scope.close();
  });

  it("propagates caller cancellation and closes the active connection", async (): Promise<void> => {
    let acceptedConnection: (() => void) | undefined;
    const connectionAccepted = new Promise<void>((resolve): void => {
      acceptedConnection = resolve;
    });
    let closedConnection: (() => void) | undefined;
    const connectionClosed = new Promise<void>((resolve): void => {
      closedConnection = resolve;
    });
    const { port } = await fakeServer((socket): void => {
      acceptedConnection?.();
      socket.once("close", (): void => {
        closedConnection?.();
      });
    });
    const controller = new AbortController();
    const scope = createExecutionContext({ timeoutMs: 500, signal: controller.signal });
    const pending = exchange(scope, port);
    await connectionAccepted;
    controller.abort();
    await expect(pending).rejects.toSatisfy(transportCode("ABORTED"));
    await connectionClosed;
    scope.close();
  });

  it("rejects oversized streams before waiting for a terminator", async (): Promise<void> => {
    const { port } = await fakeServer((socket): void => {
      socket.once("data", (): void => {
        socket.write("12345");
      });
    });
    const scope = createExecutionContext({ timeoutMs: 500 });
    await expect(exchange(scope, port, 4)).rejects.toSatisfy(transportCode("RESPONSE_TOO_LARGE"));
    scope.close();
  });

  it("rejects early EOF and protocol-declared malformed responses", async (): Promise<void> => {
    const first = await fakeServer((socket): void => {
      socket.once("data", (): void => {
        socket.end("unfinished");
      });
    });
    const earlyScope = createExecutionContext({ timeoutMs: 500 });
    await expect(exchange(earlyScope, first.port)).rejects.toSatisfy(
      transportCode("MALFORMED_RESPONSE"),
    );
    earlyScope.close();

    const second = await fakeServer((socket): void => {
      socket.once("data", (): void => {
        socket.write("bad");
      });
    });
    const malformedScope = createExecutionContext({ timeoutMs: 500 });
    const selected = target(second.port);
    await expect(
      tcpExchange({
        scope: malformedScope,
        target: selected,
        address: firstAddress(selected),
        request: Uint8Array.of(1),
        maxResponseBytes: 16,
        inspectResponse: (): "malformed" => "malformed",
      }),
    ).rejects.toSatisfy(transportCode("MALFORMED_RESPONSE"));
    malformedScope.close();
  });
});

interface ScriptedSocket {
  readonly dependencies: TcpTransportDependencies;
  readonly destroyed: () => number;
}

/** A socket that connects, then delivers `chunks` (or an error) after the request is written. */
function scriptedSocket(script: readonly Uint8Array[] | Error): ScriptedSocket {
  let destroyed = 0;
  return {
    destroyed: () => destroyed,
    dependencies: {
      now: () => 0,
      createSocket(): TcpSocketAdapter {
        let onConnect = (): void => undefined;
        let onData: (data: Uint8Array) => void = (): void => undefined;
        let onError: (error: Error) => void = (): void => undefined;
        return {
          onConnect(listener): void {
            onConnect = listener;
          },
          onData(listener): void {
            onData = listener;
          },
          onEnd(): void {
            // Not scripted.
          },
          onError(listener): void {
            onError = listener;
          },
          connect(): void {
            queueMicrotask(onConnect);
          },
          write(_data, completion): void {
            completion(undefined);
            queueMicrotask((): void => {
              if (script instanceof Error) {
                onError(script);
                return;
              }
              for (const chunk of script) {
                onData(chunk);
              }
            });
          },
          destroy(): void {
            destroyed += 1;
          },
        };
      },
    },
  };
}

function scriptedExchange(
  scope: ExecutionScope,
  socket: ScriptedSocket,
  inspectResponse: (data: Uint8Array) => TcpResponseState,
  maxResponseBytes = 64,
): Promise<Uint8Array> {
  const selected = target(25_565);
  return tcpExchange(
    {
      scope,
      target: selected,
      address: firstAddress(selected),
      request: Uint8Array.of(1),
      maxResponseBytes,
      inspectResponse,
    },
    socket.dependencies,
  ).then((result) => result.data);
}

describe("TCP transport accumulation", (): void => {
  it("accumulates many tiny segments without rebuilding the response each time", async (): Promise<void> => {
    const total = 16_384;
    const chunks = Array.from({ length: total }, (_, index) => Uint8Array.of(index % 251));
    const lengths: number[] = [];
    const buffers = new Set<ArrayBufferLike>();
    const scope = createExecutionContext({ timeoutMs: 2_000 });
    try {
      const data = await scriptedExchange(
        scope,
        scriptedSocket(chunks),
        (view): TcpResponseState => {
          lengths.push(view.byteLength);
          buffers.add(view.buffer);
          return view.byteLength === total ? "complete" : "incomplete";
        },
        total,
      );

      expect(data).toEqual(Uint8Array.from(chunks.map((chunk) => chunk[0] ?? 0)));
      expect(lengths).toHaveLength(total);
      expect(lengths.at(-1)).toBe(total);
      // Amortized doubling: a handful of allocations rather than one per segment.
      expect(buffers.size).toBeLessThanOrEqual(4);
      // The result is a copy, not a view of the buffer the callback saw.
      expect(buffers.has(data.buffer)).toBe(false);
    } finally {
      scope.close();
    }
  });

  it("maps a protocol too-large verdict to RESPONSE_TOO_LARGE", async (): Promise<void> => {
    const socket = scriptedSocket([Uint8Array.of(1, 2)]);
    const scope = createExecutionContext({ timeoutMs: 500 });
    try {
      await expect(scriptedExchange(scope, socket, () => "too-large")).rejects.toSatisfy(
        transportCode("RESPONSE_TOO_LARGE"),
      );
      expect(socket.destroyed()).toBe(1);
    } finally {
      scope.close();
    }
  });

  it("maps a socket error to CONNECTION_FAILED and destroys the socket once", async (): Promise<void> => {
    const socket = scriptedSocket(new Error("ECONNRESET detail"));
    const scope = createExecutionContext({ timeoutMs: 500 });
    try {
      const failure = scriptedExchange(scope, socket, () => "incomplete");
      await expect(failure).rejects.toSatisfy(transportCode("CONNECTION_FAILED"));
      await expect(failure).rejects.toMatchObject({
        message: "The TCP exchange could not be completed.",
      });
      scope.close();
      expect(socket.destroyed()).toBe(1);
    } finally {
      scope.close();
    }
  });
});
