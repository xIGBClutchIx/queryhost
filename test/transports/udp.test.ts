import type { Socket } from "node:dgram";

import { afterEach, describe, expect, it } from "vitest";

import type { PinnedAddress, PinnedTarget } from "../../src/network/target.js";
import { createExecutionContext, type ExecutionScope } from "../../src/runtime/execution.js";
import {
  UdpTransportError,
  udpCollect,
  udpConversation,
  udpExchange,
  type UdpRemotePeer,
  type UdpSocketAdapter,
  type UdpTransportDependencies,
} from "../../src/transports/udp.js";
import {
  startFakeUdpServer,
  stopAllFakeUdpServers,
  type FakeUdpServer,
} from "../helpers/fake-udp-server.js";

const LOOPBACK_ADDRESS: PinnedAddress = Object.freeze({ address: "127.0.0.1", family: 4 });

function createTarget(port: number, address: PinnedAddress = LOOPBACK_ADDRESS): PinnedTarget {
  return Object.freeze({
    hostname: address.address,
    port,
    addresses: Object.freeze([address]),
  });
}

function createScope(timeoutMs = 1_000, signal?: AbortSignal): ExecutionScope {
  return signal === undefined
    ? createExecutionContext({ timeoutMs })
    : createExecutionContext({ timeoutMs, signal });
}

function send(server: Socket, data: Uint8Array, port: number, address: string): void {
  server.send(data, port, address);
}

function expectTransportCode(code: UdpTransportError["code"]): (error: Error) => boolean {
  return (error: Error): boolean => error instanceof UdpTransportError && error.code === code;
}

class ControlledSocket implements UdpSocketAdapter {
  #messageListener: ((message: Uint8Array, peer: UdpRemotePeer) => void) | undefined;
  #errorListener: ((error: Error) => void) | undefined;
  public closeCalls = 0;
  public sendCalls = 0;
  public sendError: Error | undefined;
  public throwOnClose = false;
  public throwOnSend = false;
  public onSend: (() => void) | undefined;

  public onMessage(listener: (message: Uint8Array, peer: UdpRemotePeer) => void): void {
    this.#messageListener = listener;
  }

  public onError(listener: (error: Error) => void): void {
    this.#errorListener = listener;
  }

  public send(
    message: Uint8Array,
    port: number,
    address: string,
    completion: (error: Error | undefined) => void,
  ): void {
    void message;
    void port;
    void address;
    this.sendCalls += 1;
    if (this.throwOnSend) {
      throw new Error("private send failure");
    }
    this.onSend?.();
    completion(this.sendError);
  }

  public close(): void {
    this.closeCalls += 1;
    if (this.throwOnClose) {
      throw new Error("private close failure");
    }
  }

  public emitMessage(message: Uint8Array, peer: UdpRemotePeer): void {
    this.#messageListener?.(message, peer);
  }

  public emitError(): void {
    this.#errorListener?.(new Error("private socket failure"));
  }
}

function controlledDependencies(
  socket: ControlledSocket,
  times: readonly number[] = [0, 1],
): UdpTransportDependencies {
  let index = 0;
  return {
    createSocket(): UdpSocketAdapter {
      return socket;
    },
    now(): number {
      const value = times[index] ?? times.at(-1) ?? 0;
      index += 1;
      return value;
    },
  };
}

afterEach(async (): Promise<void> => {
  await stopAllFakeUdpServers();
});

describe("udpExchange integration", (): void => {
  it("exchanges one datagram with the selected pinned peer", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, message, remote): void => {
      expect([...message]).toEqual([1, 2, 3]);
      send(socket, Uint8Array.of(4, 5, 6), remote.port, remote.address);
    });
    const scope = createScope();

    const result = await udpExchange({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1, 2, 3),
      maxResponseBytes: 3,
    });
    scope.close();

    expect([...result.data]).toEqual([4, 5, 6]);
    expect(result.address).toBe(LOOPBACK_ADDRESS);
    expect(result.port).toBe(server.port);
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
  });

  it("accepts a response exactly at the configured byte limit", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(socket, Uint8Array.of(1, 2, 3, 4), remote.port, remote.address);
    });
    const scope = createScope();

    const result = await udpExchange({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 4,
    });
    scope.close();

    expect(result.data.byteLength).toBe(4);
  });

  it("rejects a response one byte over the configured limit", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(socket, Uint8Array.of(1, 2, 3, 4, 5), remote.port, remote.address);
    });
    const scope = createScope();

    await expect(
      udpExchange({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 4,
      }),
    ).rejects.toSatisfy(expectTransportCode("RESPONSE_TOO_LARGE"));
    scope.close();
  });

  it("rejects an empty datagram as transport-malformed", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(socket, new Uint8Array(), remote.port, remote.address);
    });
    const scope = createScope();

    await expect(
      udpExchange({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 16,
      }),
    ).rejects.toSatisfy(expectTransportCode("MALFORMED_RESPONSE"));
    scope.close();
  });

  it("times out when the server does not respond", async (): Promise<void> => {
    const server = await startFakeUdpServer((): void => undefined);
    const scope = createScope(20);

    await expect(
      udpExchange({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 16,
      }),
    ).rejects.toSatisfy(expectTransportCode("TIMEOUT"));
  });

  it("stops promptly when the caller cancels", async (): Promise<void> => {
    const server = await startFakeUdpServer((): void => undefined);
    const controller = new AbortController();
    const scope = createScope(1_000, controller.signal);
    const exchange = udpExchange({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 16,
    });

    controller.abort();

    await expect(exchange).rejects.toSatisfy(expectTransportCode("ABORTED"));
  });

  it("ignores an oversized datagram from the wrong source port", async (): Promise<void> => {
    const rogue: FakeUdpServer = await startFakeUdpServer((): void => undefined);
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(rogue.socket, new Uint8Array(128), remote.port, remote.address);
      setTimeout((): void => {
        send(socket, Uint8Array.of(9), remote.port, remote.address);
      }, 5);
    });
    const scope = createScope();

    const result = await udpExchange({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 1,
    });
    scope.close();

    expect([...result.data]).toEqual([9]);
  });

  it("keeps concurrent exchanges isolated", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, message, remote): void => {
      const value = message[0] ?? 0;
      const delayMs = value === 1 ? 10 : 1;
      setTimeout((): void => {
        send(socket, Uint8Array.of(value + 10), remote.port, remote.address);
      }, delayMs);
    });
    const firstScope = createScope();
    const secondScope = createScope();
    const target = createTarget(server.port);

    const [first, second] = await Promise.all([
      udpExchange({
        scope: firstScope,
        target,
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      }),
      udpExchange({
        scope: secondScope,
        target,
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(2),
        maxResponseBytes: 1,
      }),
    ]);
    firstScope.close();
    secondScope.close();

    expect([...first.data]).toEqual([11]);
    expect([...second.data]).toEqual([12]);
  });
});

describe("udpConversation integration", (): void => {
  it("retains one client source port across challenge steps", async (): Promise<void> => {
    const clientPorts = new Set<number>();
    const server = await startFakeUdpServer((socket, message, remote): void => {
      clientPorts.add(remote.port);
      if (message[0] === 1) {
        send(socket, Uint8Array.of(11), remote.port, remote.address);
      } else if (message[0] === 2) {
        send(socket, Uint8Array.of(22), remote.port, remote.address);
      }
    });
    const scope = createScope();

    const result = await udpConversation({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 8,
      maxResponses: 2,
      maxTotalResponseBytes: 16,
      nextRequest: (responses): Uint8Array | undefined =>
        responses.length === 1 ? Uint8Array.of(2) : undefined,
    });
    scope.close();

    expect(result.responses).toEqual([Uint8Array.of(11), Uint8Array.of(22)]);
    expect(clientPorts.size).toBe(1);
    expect(result.rttMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates cancellation while waiting between conversation steps", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, message, remote): void => {
      if (message[0] === 1) {
        send(socket, Uint8Array.of(11), remote.port, remote.address);
      }
    });
    const controller = new AbortController();
    const scope = createScope(1_000, controller.signal);
    let secondRequestSent: (() => void) | undefined;
    const sent = new Promise<void>((resolve): void => {
      secondRequestSent = resolve;
    });
    const conversation = udpConversation({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 8,
      maxResponses: 2,
      maxTotalResponseBytes: 16,
      nextRequest: (): Uint8Array => {
        secondRequestSent?.();
        return Uint8Array.of(2);
      },
    });
    await sent;
    controller.abort();

    await expect(conversation).rejects.toSatisfy(expectTransportCode("ABORTED"));
  });

  it("enforces the combined response limit across steps", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, message, remote): void => {
      send(socket, new Uint8Array(message[0] === 1 ? 5 : 4), remote.port, remote.address);
    });
    const scope = createScope();
    await expect(
      udpConversation({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 8,
        maxResponses: 2,
        maxTotalResponseBytes: 8,
        nextRequest: (responses): Uint8Array | undefined =>
          responses.length === 1 ? Uint8Array.of(2) : undefined,
      }),
    ).rejects.toSatisfy(expectTransportCode("RESPONSE_TOO_LARGE"));
    scope.close();
  });
});

describe("udpCollect integration", (): void => {
  it("collects matching datagrams until the protocol reports completion", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(socket, Uint8Array.of(1), remote.port, remote.address);
      send(socket, Uint8Array.of(2), remote.port, remote.address);
    });
    const scope = createScope();

    const result = await udpCollect({
      scope,
      target: createTarget(server.port),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(9),
      maxResponseBytes: 4,
      maxDatagrams: 2,
      maxTotalResponseBytes: 8,
      isComplete: (datagrams): boolean => datagrams.length === 2,
    });
    scope.close();

    expect(result.datagrams).toEqual([Uint8Array.of(1), Uint8Array.of(2)]);
  });

  it("fails closed when a sender exceeds the datagram-count bound", async (): Promise<void> => {
    const server = await startFakeUdpServer((socket, _message, remote): void => {
      send(socket, Uint8Array.of(1), remote.port, remote.address);
      send(socket, Uint8Array.of(1), remote.port, remote.address);
      send(socket, Uint8Array.of(1), remote.port, remote.address);
    });
    const scope = createScope();

    await expect(
      udpCollect({
        scope,
        target: createTarget(server.port),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(9),
        maxResponseBytes: 1,
        maxDatagrams: 2,
        maxTotalResponseBytes: 2,
        isComplete: (): boolean => false,
      }),
    ).rejects.toSatisfy(expectTransportCode("RESPONSE_TOO_LARGE"));
    scope.close();
  });
});

describe("udpExchange boundaries", (): void => {
  it("rejects a selected address that is not in the pinned target", async (): Promise<void> => {
    const scope = createScope();

    await expect(
      udpExchange({
        scope,
        target: createTarget(27_015),
        address: { address: "8.8.8.8", family: 4 },
        request: Uint8Array.of(1),
        maxResponseBytes: 16,
      }),
    ).rejects.toSatisfy(expectTransportCode("INVALID_INPUT"));
    scope.close();
  });

  it.each([
    { request: new Uint8Array(), maxResponseBytes: 1 },
    { request: new Uint8Array(65_508), maxResponseBytes: 1 },
    { request: Uint8Array.of(1), maxResponseBytes: 0 },
    { request: Uint8Array.of(1), maxResponseBytes: 65_508 },
  ])("rejects invalid datagram limits", async ({ request, maxResponseBytes }): Promise<void> => {
    const scope = createScope();

    await expect(
      udpExchange({
        scope,
        target: createTarget(27_015),
        address: LOOPBACK_ADDRESS,
        request,
        maxResponseBytes,
      }),
    ).rejects.toSatisfy(expectTransportCode("INVALID_INPUT"));
    scope.close();
  });

  it("rejects a truncated datagram reported by the socket adapter", async (): Promise<void> => {
    const socket = new ControlledSocket();
    socket.onSend = (): void => {
      socket.emitMessage(Uint8Array.of(1, 2), {
        address: LOOPBACK_ADDRESS.address,
        port: 27_015,
        size: 3,
      });
    };
    const scope = createScope();

    await expect(
      udpExchange(
        {
          scope,
          target: createTarget(27_015),
          address: LOOPBACK_ADDRESS,
          request: Uint8Array.of(1),
          maxResponseBytes: 16,
        },
        controlledDependencies(socket),
      ),
    ).rejects.toSatisfy(expectTransportCode("MALFORMED_RESPONSE"));
    scope.close();
    expect(socket.closeCalls).toBe(1);
  });

  it("ignores a wrong source address before accepting the pinned peer", async (): Promise<void> => {
    const socket = new ControlledSocket();
    socket.onSend = (): void => {
      socket.emitMessage(new Uint8Array(128), {
        address: "203.0.113.10",
        port: 27_015,
        size: 128,
      });
      socket.emitMessage(Uint8Array.of(7), {
        address: LOOPBACK_ADDRESS.address,
        port: 27_015,
        size: 1,
      });
    };
    const scope = createScope();

    const result = await udpExchange(
      {
        scope,
        target: createTarget(27_015),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      },
      controlledDependencies(socket),
    );
    scope.close();

    expect([...result.data]).toEqual([7]);
    expect(socket.closeCalls).toBe(1);
  });

  it("normalizes IPv6 spellings when validating the sender", async (): Promise<void> => {
    const address: PinnedAddress = { address: "2001:4860:4860::8888", family: 6 };
    const socket = new ControlledSocket();
    socket.onSend = (): void => {
      socket.emitMessage(Uint8Array.of(1), {
        address: "2001:4860:4860:0:0:0:0:8888",
        port: 27_015,
        size: 1,
      });
    };
    const scope = createScope();

    const result = await udpExchange(
      {
        scope,
        target: createTarget(27_015, address),
        address,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      },
      controlledDependencies(socket),
    );
    scope.close();

    expect([...result.data]).toEqual([1]);
  });

  it("maps socket creation, send, and socket errors to stable failures", async (): Promise<void> => {
    const creationScope = createScope();
    const creationDependencies: UdpTransportDependencies = {
      createSocket(): UdpSocketAdapter {
        throw new Error("private create failure");
      },
      now(): number {
        return 0;
      },
    };
    const options = {
      scope: creationScope,
      target: createTarget(27_015),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 16,
    } as const;

    await expect(udpExchange(options, creationDependencies)).rejects.toSatisfy(
      expectTransportCode("CONNECTION_FAILED"),
    );
    creationScope.close();

    const sendSocket = new ControlledSocket();
    sendSocket.sendError = new Error("private send failure");
    const sendScope = createScope();
    await expect(
      udpExchange({ ...options, scope: sendScope }, controlledDependencies(sendSocket)),
    ).rejects.toSatisfy(expectTransportCode("CONNECTION_FAILED"));
    sendScope.close();
    expect(sendSocket.closeCalls).toBe(1);

    const errorSocket = new ControlledSocket();
    errorSocket.onSend = (): void => {
      errorSocket.emitError();
    };
    const errorScope = createScope();
    await expect(
      udpExchange({ ...options, scope: errorScope }, controlledDependencies(errorSocket)),
    ).rejects.toSatisfy(expectTransportCode("CONNECTION_FAILED"));
    errorScope.close();
    expect(errorSocket.closeCalls).toBe(1);
  });

  it("closes once and preserves success when socket close throws", async (): Promise<void> => {
    const socket = new ControlledSocket();
    socket.throwOnClose = true;
    socket.onSend = (): void => {
      socket.emitMessage(Uint8Array.of(1), {
        address: LOOPBACK_ADDRESS.address,
        port: 27_015,
        size: 1,
      });
    };
    const scope = createScope();

    const result = await udpExchange(
      {
        scope,
        target: createTarget(27_015),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      },
      controlledDependencies(socket),
    );
    scope.close();

    expect([...result.data]).toEqual([1]);
    expect(socket.closeCalls).toBe(1);
  });

  it("accepts only the first duplicate datagram", async (): Promise<void> => {
    const socket = new ControlledSocket();
    socket.onSend = (): void => {
      const peer = { address: LOOPBACK_ADDRESS.address, port: 27_015, size: 1 } as const;
      socket.emitMessage(Uint8Array.of(1), peer);
      socket.emitMessage(Uint8Array.of(2), peer);
    };
    const scope = createScope();

    const result = await udpExchange(
      {
        scope,
        target: createTarget(27_015),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      },
      controlledDependencies(socket),
    );
    scope.close();

    expect([...result.data]).toEqual([1]);
    expect(socket.closeCalls).toBe(1);
  });

  it("isolates a late datagram from the next exchange", async (): Promise<void> => {
    const firstSocket = new ControlledSocket();
    const secondSocket = new ControlledSocket();
    const peer = { address: LOOPBACK_ADDRESS.address, port: 27_015, size: 1 } as const;
    firstSocket.onSend = (): void => {
      firstSocket.emitMessage(Uint8Array.of(1), peer);
    };
    secondSocket.onSend = (): void => {
      firstSocket.emitMessage(Uint8Array.of(99), peer);
      secondSocket.emitMessage(Uint8Array.of(2), peer);
    };
    const sockets = [firstSocket, secondSocket] as const;
    let socketIndex = 0;
    const dependencies: UdpTransportDependencies = {
      createSocket(): UdpSocketAdapter {
        const socket = sockets[socketIndex];
        socketIndex += 1;
        if (socket === undefined) {
          throw new Error("No controlled socket remains.");
        }
        return socket;
      },
      now(): number {
        return socketIndex;
      },
    };
    const firstScope = createScope();
    const secondScope = createScope();
    const options = {
      target: createTarget(27_015),
      address: LOOPBACK_ADDRESS,
      request: Uint8Array.of(1),
      maxResponseBytes: 1,
    } as const;

    const first = await udpExchange({ ...options, scope: firstScope }, dependencies);
    const second = await udpExchange({ ...options, scope: secondScope }, dependencies);
    firstScope.close();
    secondScope.close();

    expect([...first.data]).toEqual([1]);
    expect([...second.data]).toEqual([2]);
    expect(firstSocket.closeCalls).toBe(1);
    expect(secondSocket.closeCalls).toBe(1);
  });

  it("closes the socket once on timeout and caller cancellation", async (): Promise<void> => {
    const timeoutSocket = new ControlledSocket();
    const timeoutScope = createScope(10);
    await expect(
      udpExchange(
        {
          scope: timeoutScope,
          target: createTarget(27_015),
          address: LOOPBACK_ADDRESS,
          request: Uint8Array.of(1),
          maxResponseBytes: 1,
        },
        controlledDependencies(timeoutSocket),
      ),
    ).rejects.toSatisfy(expectTransportCode("TIMEOUT"));
    expect(timeoutSocket.closeCalls).toBe(1);

    const cancellationSocket = new ControlledSocket();
    const controller = new AbortController();
    const cancellationScope = createScope(1_000, controller.signal);
    const exchange = udpExchange(
      {
        scope: cancellationScope,
        target: createTarget(27_015),
        address: LOOPBACK_ADDRESS,
        request: Uint8Array.of(1),
        maxResponseBytes: 1,
      },
      controlledDependencies(cancellationSocket),
    );
    controller.abort();

    await expect(exchange).rejects.toSatisfy(expectTransportCode("ABORTED"));
    expect(cancellationSocket.closeCalls).toBe(1);
  });

  it("does not create a socket for an already-cancelled scope", async (): Promise<void> => {
    const socket = new ControlledSocket();
    const controller = new AbortController();
    controller.abort();
    const scope = createScope(1_000, controller.signal);

    await expect(
      udpExchange(
        {
          scope,
          target: createTarget(27_015),
          address: LOOPBACK_ADDRESS,
          request: Uint8Array.of(1),
          maxResponseBytes: 1,
        },
        controlledDependencies(socket),
      ),
    ).rejects.toSatisfy(expectTransportCode("ABORTED"));

    expect(socket.sendCalls).toBe(0);
    expect(socket.closeCalls).toBe(0);
  });
});
