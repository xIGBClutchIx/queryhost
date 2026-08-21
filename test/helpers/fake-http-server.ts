/** Small real-socket HTTP server used by deterministic transport integration tests. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export type FakeHttpHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface FakeHttpServer {
  readonly host: string;
  readonly port: number;
  readonly server: Server;
}

const OPEN_SERVERS = new Map<Server, Set<Socket>>();

export async function startFakeHttpServer(
  handler: FakeHttpHandler,
  host = "127.0.0.1",
): Promise<FakeHttpServer> {
  const server = createServer(handler);
  const sockets = new Set<Socket>();
  server.on("connection", (socket): void => {
    sockets.add(socket);
    socket.once("close", (): void => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject): void => {
    const handleError = (error: Error): void => {
      reject(error);
    };
    server.once("error", handleError);
    server.listen(0, host, (): void => {
      server.off("error", handleError);
      resolve();
    });
  });
  OPEN_SERVERS.set(server, sockets);
  const address = server.address();
  if (address === null || typeof address === "string") {
    await stopFakeHttpServer(server);
    throw new Error("The fake HTTP server did not expose an IP port.");
  }
  return { host, port: address.port, server };
}

export async function stopFakeHttpServer(server: Server): Promise<void> {
  const sockets = OPEN_SERVERS.get(server);
  if (sockets === undefined) {
    return;
  }
  OPEN_SERVERS.delete(server);
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve): void => {
    server.close((): void => {
      resolve();
    });
  });
}

export async function stopAllFakeHttpServers(): Promise<void> {
  await Promise.all([...OPEN_SERVERS.keys()].map(stopFakeHttpServer));
}
