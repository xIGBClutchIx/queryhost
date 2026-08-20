/** Small real-socket UDP server used by deterministic transport integration tests. */

import { createSocket, type RemoteInfo, type Socket } from "node:dgram";

export type FakeUdpHandler = (server: Socket, message: Buffer, remote: RemoteInfo) => void;

export interface FakeUdpServer {
  readonly host: string;
  readonly port: number;
  readonly socket: Socket;
}

const OPEN_SERVERS = new Set<Socket>();

export async function startFakeUdpServer(
  handler: FakeUdpHandler,
  host = "127.0.0.1",
): Promise<FakeUdpServer> {
  const socket = createSocket("udp4");
  socket.on("message", (message, remote): void => {
    handler(socket, message, remote);
  });

  await new Promise<void>((resolve, reject): void => {
    const handleError = (error: Error): void => {
      reject(error);
    };
    socket.once("error", handleError);
    socket.bind(0, host, (): void => {
      socket.off("error", handleError);
      resolve();
    });
  });

  OPEN_SERVERS.add(socket);
  const address = socket.address();
  if (typeof address === "string") {
    await stopFakeUdpServer(socket);
    throw new Error("Expected an IP socket address.");
  }

  return { host, port: address.port, socket };
}

export async function stopFakeUdpServer(socket: Socket): Promise<void> {
  if (!OPEN_SERVERS.delete(socket)) {
    return;
  }

  await new Promise<void>((resolve): void => {
    try {
      socket.close(resolve);
    } catch {
      resolve();
    }
  });
}

export async function stopAllFakeUdpServers(): Promise<void> {
  await Promise.all([...OPEN_SERVERS].map(async (socket) => stopFakeUdpServer(socket)));
}
