/** Minecraft Bedrock profile over one required RakNet unconnected ping source. */

import type { MinecraftBedrockData } from "../contracts/games.js";
import type { ExecutionScope } from "../runtime/execution.js";
import {
  createMinecraftBedrockClientGuid,
  queryMinecraftBedrockPing,
  type MinecraftBedrockPingDependencies,
  type MinecraftBedrockPingResult,
} from "../protocols/minecraft-bedrock/ping.js";
import type {
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedTarget } from "../network/target.js";
import { UdpTransportError } from "../transports/udp.js";

const PING_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface MinecraftBedrockProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the Bedrock destination. */
export interface MinecraftBedrockProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly observer: MinecraftBedrockProfileObserver;
  readonly ping?: MinecraftBedrockPingDependencies;
  readonly random?: () => number;
  readonly wallNow?: () => number;
}

/** Fully interpreted Bedrock result before the public query envelope is added. */
export interface MinecraftBedrockProfileResult {
  readonly server: ServerInfo;
  readonly data: MinecraftBedrockData;
  readonly sources: readonly [QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

function rootTermination(scope: ExecutionScope): UdpTransportError {
  return new UdpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function requiredPing(
  options: MinecraftBedrockProfileOptions,
): Promise<{ readonly result: MinecraftBedrockPingResult; readonly report: QuerySource }> {
  options.observer.onSourceStarted("minecraft-bedrock-raknet");
  const timestamp = BigInt(Math.floor((options.wallNow ?? Date.now)()));
  const clientGuid = createMinecraftBedrockClientGuid(options.random ?? Math.random);
  let lastError: Error | undefined;
  for (const address of options.target.addresses) {
    const operation = options.scope.createOperation(
      PING_OPERATION_TIMEOUT_MS,
      "minecraft-bedrock-raknet",
    );
    try {
      const result = await queryMinecraftBedrockPing(
        {
          scope: operation,
          target: options.target,
          address,
          pingTimestamp: timestamp,
          clientGuid,
        },
        options.ping,
      );
      const report: QuerySource = Object.freeze({
        source: "minecraft-bedrock-raknet",
        status: "ok",
        rttMs: result.rttMs,
      });
      options.observer.onSourceCompleted(report);
      return Object.freeze({ result, report });
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("Minecraft Bedrock ping failed.");
    } finally {
      operation.close();
    }
  }
  throw lastError ?? new Error("Minecraft Bedrock target had no validated addresses.");
}

/** Queries the required RakNet source and maps its advertised fields into stable contracts. */
export async function queryMinecraftBedrockProfile(
  options: MinecraftBedrockProfileOptions,
): Promise<MinecraftBedrockProfileResult> {
  const ping = await requiredPing(options);
  const pong = ping.result.pong;
  const players =
    pong.playersOnline === undefined && pong.playersMax === undefined
      ? undefined
      : Object.freeze({
          ...(pong.playersOnline === undefined ? {} : { online: pong.playersOnline }),
          ...(pong.playersMax === undefined ? {} : { max: pong.playersMax }),
        });
  const server: ServerInfo = Object.freeze({
    ...(pong.motd === undefined ? {} : { name: pong.motd }),
    ...(pong.version === undefined ? {} : { version: pong.version }),
    ...(players === undefined ? {} : { players }),
    queryRttMs: ping.result.rttMs,
  });
  const data: MinecraftBedrockData = Object.freeze({
    edition: pong.edition,
    ...(pong.motd === undefined ? {} : { motd: pong.motd }),
    ...(pong.protocolVersion === undefined ? {} : { protocolVersion: pong.protocolVersion }),
    ...(pong.gameMode === undefined ? {} : { gameMode: pong.gameMode }),
    ...(pong.serverId === undefined ? {} : { serverId: pong.serverId }),
    ...(pong.advertisedIpv4Port === undefined
      ? {}
      : { advertisedIpv4Port: pong.advertisedIpv4Port }),
    ...(pong.advertisedIpv6Port === undefined
      ? {}
      : { advertisedIpv6Port: pong.advertisedIpv6Port }),
  });
  const sources: readonly [QuerySource] = Object.freeze([ping.report]);
  return Object.freeze({
    server,
    data,
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}
