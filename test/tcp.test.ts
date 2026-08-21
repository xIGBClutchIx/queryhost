import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createExecutionContext, type ExecutionScope } from "../src/execution.js";
import type { PinnedAddress, PinnedTarget } from "../src/target.js";
import { tcpExchange, TcpTransportError } from "../src/transports/tcp.js";

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
