/** Shared A2S profile execution without game-specific rule interpretation. */

import type { ExecutionScope } from "../execution.js";
import type {
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  ServerInfo,
} from "../shared.js";
import type { PinnedAddress, PinnedTarget } from "../target.js";
import { UdpTransportError } from "../transports/udp.js";
import { queryA2sInfo, type A2sInfoQueryResult } from "../protocols/a2s/info.js";
import type { A2sExchangeDependencies } from "../protocols/a2s/network.js";
import {
  queryA2sOptionalSources,
  type A2sOptionalSourcesResult,
} from "../protocols/a2s/optional.js";

const INFO_OPERATION_TIMEOUT_MS = 2_000;
const OPTIONAL_OPERATION_TIMEOUT_MS = 1_500;

/** Internal source lifecycle observer used to preserve whole-query provenance. */
export interface A2sProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs shared by game profiles that use required Info and optional Player and Rules. */
export interface A2sProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly mode: QueryMode;
  readonly observer: A2sProfileObserver;
  readonly a2s?: A2sExchangeDependencies;
}

/** Protocol facts collected before one game profile interprets them. */
export interface A2sProfileResult {
  readonly info: A2sInfoQueryResult;
  readonly optional: A2sOptionalSourcesResult;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
}

interface InfoSuccess {
  readonly result: A2sInfoQueryResult;
  readonly address: PinnedAddress;
  readonly report: QuerySource;
}

function rootTermination(scope: ExecutionScope): UdpTransportError {
  return new UdpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function queryRequiredInfo(options: A2sProfileOptions): Promise<InfoSuccess> {
  let lastError: Error | undefined;
  options.observer.onSourceStarted("a2s-info");

  for (const address of options.target.addresses) {
    const operation = options.scope.createOperation(INFO_OPERATION_TIMEOUT_MS, "a2s-info");
    try {
      const result = await queryA2sInfo(
        { scope: operation, target: options.target, address },
        options.a2s,
      );
      const report: QuerySource = {
        source: "a2s-info",
        status: "ok",
        rttMs: result.rttMs,
      };
      options.observer.onSourceCompleted(report);
      return { result, address, report };
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("The A2S Info source failed.");
    } finally {
      operation.close();
    }
  }

  throw lastError ?? new Error("The pinned A2S target has no addresses.");
}

function isOptionalFailure(status: QuerySourceStatus): boolean {
  return (
    status === "timeout" || status === "blocked" || status === "malformed" || status === "failed"
  );
}

function sourceWarning(gameName: string, source: QuerySource): QueryWarning | undefined {
  if (source.status === "timeout") {
    return {
      code: "SOURCE_TIMEOUT",
      message: `An optional ${gameName} query source timed out.`,
      source: source.source,
    };
  }
  if (source.status === "blocked") {
    return {
      code: "SOURCE_BLOCKED",
      message: `An optional ${gameName} query source was blocked.`,
      source: source.source,
    };
  }
  if (source.status === "malformed") {
    return {
      code: "SOURCE_MALFORMED",
      message: `An optional ${gameName} query source returned malformed data.`,
      source: source.source,
    };
  }
  if (source.status === "failed") {
    return {
      code: "SOURCE_FAILED",
      message: `An optional ${gameName} query source failed.`,
      source: source.source,
    };
  }
  return undefined;
}

/** Builds the common server fields that are direct A2S Info facts. */
export function a2sServerInfo(result: A2sInfoQueryResult): ServerInfo {
  const info = result.info;
  return Object.freeze({
    name: info.name,
    map: info.map,
    ...(info.format === "source" ? { version: info.version } : {}),
    password: info.password,
    players: Object.freeze({ online: info.players, max: info.maxPlayers }),
    queryRttMs: result.rttMs,
  });
}

/** Builds stable partial-result warnings without interpreting game-owned rule keys. */
export function a2sProfileWarnings(
  gameName: string,
  optionalSources: readonly [QuerySource, QuerySource],
): readonly QueryWarning[] {
  const failed = optionalSources.filter((source) => isOptionalFailure(source.status));
  if (failed.length === 0) {
    return Object.freeze([]);
  }

  const result: QueryWarning[] = [
    {
      code: "PARTIAL_RESULT",
      message: `One or more optional ${gameName} query sources did not complete successfully.`,
    },
  ];
  for (const source of failed) {
    if (source.source === "a2s-player") {
      result.push({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: `The ${gameName} player list is unavailable.`,
        source: source.source,
      });
    }
    const warning = sourceWarning(gameName, source);
    if (warning !== undefined) {
      result.push(warning);
    }
  }
  return Object.freeze(result.map((warning) => Object.freeze(warning)));
}

/** Queries required Info and optional Player and Rules against one pinned server instance. */
export async function queryA2sProfile(options: A2sProfileOptions): Promise<A2sProfileResult> {
  const info = await queryRequiredInfo(options);
  const queryOptional = options.mode === "full";
  const optional = await queryA2sOptionalSources(
    {
      scope: options.scope,
      target: options.target,
      address: info.address,
      operationTimeoutMs: OPTIONAL_OPERATION_TIMEOUT_MS,
      player: queryOptional ? "query" : "not-requested",
      rules: queryOptional ? "query" : "not-requested",
      onSourceStarted: options.observer.onSourceStarted,
      onSourceCompleted: options.observer.onSourceCompleted,
    },
    options.a2s,
  );
  const sources: readonly [QuerySource, QuerySource, QuerySource] = Object.freeze([
    Object.freeze(info.report),
    Object.freeze(optional.sources[0]),
    Object.freeze(optional.sources[1]),
  ]);
  return Object.freeze({
    info: info.result,
    optional,
    sources,
  });
}
