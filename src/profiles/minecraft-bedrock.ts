/** Minecraft Bedrock status over NetherNet HTTP with a same-endpoint RakNet fallback. */

import type { MinecraftBedrockData } from "../contracts/games.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { raceAttempts } from "../runtime/attempt-race.js";
import { bedrockCrossplay } from "./minecraft-crossplay.js";
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
import { HttpTransportError } from "../transports/http.js";
import { MinecraftBedrockProtocolError } from "../protocols/minecraft-bedrock/errors.js";
import {
  queryNetherNetStatus,
  type NetherNetDependencies,
} from "../protocols/minecraft-bedrock/nethernet.js";

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
  readonly nethernet?: NetherNetDependencies;
  readonly random?: () => number;
  readonly wallNow?: () => number;
}

/** Fully interpreted Bedrock result before the public query envelope is added. */
export interface MinecraftBedrockProfileResult {
  readonly server: ServerInfo;
  readonly data: MinecraftBedrockData;
  readonly sources: readonly [QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

interface BedrockAnswer {
  readonly server: ServerInfo;
  readonly data: MinecraftBedrockData;
  readonly report: QuerySource;
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
  const { value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: PING_OPERATION_TIMEOUT_MS,
      source: "minecraft-bedrock-raknet",
      terminated: () => rootTermination(options.scope),
      empty: () => new Error("Minecraft Bedrock target had no validated addresses."),
    },
    (address, operation) =>
      queryMinecraftBedrockPing(
        {
          scope: operation,
          target: options.target,
          address,
          pingTimestamp: timestamp,
          clientGuid,
        },
        options.ping,
      ),
  );
  const report: QuerySource = Object.freeze({
    source: "minecraft-bedrock-raknet",
    status: "ok",
    rttMs: result.rttMs,
  });
  options.observer.onSourceCompleted(report);
  return Object.freeze({ result, report });
}

/** Maps RakNet advertisements without treating their reported ports as connection targets. */
async function raknetProfile(options: MinecraftBedrockProfileOptions): Promise<BedrockAnswer> {
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
    transport: "raknet",
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
    ...bedrockCrossplay(pong.subMotd),
  });
  return Object.freeze({ server, data, report: ping.report });
}

function failedNetherNet(error: Error): QuerySource {
  const code =
    error instanceof HttpTransportError || error instanceof MinecraftBedrockProtocolError
      ? error.code
      : undefined;
  return Object.freeze({
    source: "minecraft-bedrock-nethernet",
    status:
      code === "TIMEOUT"
        ? "timeout"
        : code === "MALFORMED_RESPONSE" || code === "RESPONSE_TOO_LARGE"
          ? "malformed"
          : "failed",
  });
}

async function nethernetProfile(options: MinecraftBedrockProfileOptions): Promise<BedrockAnswer> {
  const source = "minecraft-bedrock-nethernet";
  options.observer.onSourceStarted(source);
  const { value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: PING_OPERATION_TIMEOUT_MS,
      source,
      terminated: () =>
        new HttpTransportError(
          options.scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED",
        ),
      empty: () => new HttpTransportError("CONNECTION_FAILED"),
    },
    (address, scope) =>
      queryNetherNetStatus({ scope, target: options.target, address }, options.nethernet),
  );
  const value = result.status;
  const players =
    value.players === undefined && value.maxPlayers === undefined
      ? undefined
      : Object.freeze({
          ...(value.players === undefined ? {} : { online: value.players }),
          ...(value.maxPlayers === undefined ? {} : { max: value.maxPlayers }),
        });
  const server: ServerInfo = Object.freeze({
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.level === undefined ? {} : { map: value.level }),
    ...(value.version === undefined ? {} : { version: value.version }),
    ...(players === undefined ? {} : { players }),
    queryRttMs: result.rttMs,
  });
  const gameMode =
    value.gameType === 0
      ? "Survival"
      : value.gameType === 1
        ? "Creative"
        : value.gameType === 2
          ? "Adventure"
          : undefined;
  const data: MinecraftBedrockData = Object.freeze({
    transport: "nethernet",
    ...(value.name === undefined ? {} : { motd: value.name }),
    ...(value.protocol === undefined ? {} : { protocolVersion: value.protocol }),
    ...(value.gameType === undefined ? {} : { gameType: value.gameType }),
    ...(gameMode === undefined ? {} : { gameMode }),
  });
  const completed: QuerySource = Object.freeze({ source, status: "ok", rttMs: result.rttMs });
  options.observer.onSourceCompleted(completed);
  return Object.freeze({ server, data, report: completed });
}

function complete(
  answer: BedrockAnswer,
  sources: MinecraftBedrockProfileResult["sources"],
): MinecraftBedrockProfileResult {
  return Object.freeze({
    server: answer.server,
    data: answer.data,
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}

/** Prefers NetherNet while reserving deadline for RakNet; both share the outbound-work cap. */
export async function queryMinecraftBedrockProfile(
  options: MinecraftBedrockProfileOptions,
): Promise<MinecraftBedrockProfileResult> {
  const httpScope = options.scope.createOperation(
    Math.max(1, Math.floor(options.scope.remainingMs / 2)),
    "minecraft-bedrock-nethernet",
  );
  let report: QuerySource;
  try {
    const answer = await nethernetProfile({ ...options, scope: httpScope });
    const skipped: QuerySource = Object.freeze({
      source: "minecraft-bedrock-raknet",
      status: "not-requested",
    });
    options.observer.onSourceCompleted(skipped);
    return complete(answer, Object.freeze([answer.report, skipped]));
  } catch (error) {
    if (options.scope.signal.aborted) {
      throw new HttpTransportError(
        options.scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED",
      );
    }
    report = failedNetherNet(
      error instanceof Error ? error : new Error("Bedrock discovery failed."),
    );
    options.observer.onSourceCompleted(report);
  } finally {
    httpScope.close();
  }
  const answer = await raknetProfile(options);
  return complete(answer, Object.freeze([report, answer.report]));
}
