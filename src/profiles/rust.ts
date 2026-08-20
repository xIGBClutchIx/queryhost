/** Rust-specific merging over reusable A2S protocol sources. */

import type { ExecutionScope } from "../execution.js";
import type { RustData, RustPlayer } from "../games.js";
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
import { queryA2sOptionalSources } from "../protocols/a2s/optional.js";

const INFO_OPERATION_TIMEOUT_MS = 2_000;
const OPTIONAL_OPERATION_TIMEOUT_MS = 1_500;

/** Internal source lifecycle observer for whole-query provenance. */
export interface RustProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public query layer resolves and pins a Rust destination. */
export interface RustProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly mode: QueryMode;
  readonly observer: RustProfileObserver;
  readonly a2s?: A2sExchangeDependencies;
}

/** Fully merged Rust profile result before the public query envelope is added. */
export interface RustProfileResult {
  readonly server: ServerInfo;
  readonly data: RustData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

interface InfoSuccess {
  readonly result: A2sInfoQueryResult;
  readonly address: PinnedAddress;
  readonly report: QuerySource;
}

function rootTermination(scope: ExecutionScope): UdpTransportError {
  return new UdpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function queryRequiredInfo(options: RustProfileOptions): Promise<InfoSuccess> {
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

  throw lastError ?? new Error("The pinned Rust target has no addresses.");
}

function tags(keywords: string): readonly string[] {
  return Object.freeze(
    keywords
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  );
}

function rustPlayers(players: readonly RustPlayer[]): readonly RustPlayer[] {
  return Object.freeze(
    players.map((player) =>
      Object.freeze({
        index: player.index,
        name: player.name,
        score: player.score,
        durationSeconds: player.durationSeconds,
      }),
    ),
  );
}

function isOptionalFailure(status: QuerySourceStatus): boolean {
  return (
    status === "timeout" || status === "blocked" || status === "malformed" || status === "failed"
  );
}

function sourceWarning(source: QuerySource): QueryWarning | undefined {
  if (source.status === "timeout") {
    return {
      code: "SOURCE_TIMEOUT",
      message: "An optional Rust query source timed out.",
      source: source.source,
    };
  }
  if (source.status === "blocked") {
    return {
      code: "SOURCE_BLOCKED",
      message: "An optional Rust query source was blocked.",
      source: source.source,
    };
  }
  if (source.status === "malformed") {
    return {
      code: "SOURCE_MALFORMED",
      message: "An optional Rust query source returned malformed data.",
      source: source.source,
    };
  }
  if (source.status === "failed") {
    return {
      code: "SOURCE_FAILED",
      message: "An optional Rust query source failed.",
      source: source.source,
    };
  }
  return undefined;
}

function warnings(optionalSources: readonly [QuerySource, QuerySource]): readonly QueryWarning[] {
  const failed = optionalSources.filter((source) => isOptionalFailure(source.status));
  if (failed.length === 0) {
    return Object.freeze([]);
  }

  const result: QueryWarning[] = [
    {
      code: "PARTIAL_RESULT",
      message: "One or more optional Rust query sources did not complete successfully.",
    },
  ];
  for (const source of failed) {
    if (source.source === "a2s-player") {
      result.push({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: "The Rust player list is unavailable.",
        source: source.source,
      });
    }
    const warning = sourceWarning(source);
    if (warning !== undefined) {
      result.push(warning);
    }
  }
  return Object.freeze(result.map((warning) => Object.freeze(warning)));
}

/** Queries and merges the required and optional Rust A2S sources. */
export async function queryRustProfile(options: RustProfileOptions): Promise<RustProfileResult> {
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
  const protocolInfo = info.result.info;
  const server: ServerInfo = Object.freeze({
    name: protocolInfo.name,
    map: protocolInfo.map,
    ...(protocolInfo.format === "source" ? { version: protocolInfo.version } : {}),
    password: protocolInfo.password,
    players: Object.freeze({ online: protocolInfo.players, max: protocolInfo.maxPlayers }),
    queryRttMs: info.result.rttMs,
  });
  const data: RustData = Object.freeze({
    ...(protocolInfo.format === "source" && protocolInfo.keywords !== undefined
      ? { tags: tags(protocolInfo.keywords) }
      : {}),
    ...(optional.players === undefined ? {} : { players: rustPlayers(optional.players) }),
    ...(optional.rules === undefined ? {} : { rules: optional.rules }),
  });
  const optionalWarnings = warnings(optional.sources);
  const sources: readonly [QuerySource, QuerySource, QuerySource] = Object.freeze([
    Object.freeze(info.report),
    Object.freeze(optional.sources[0]),
    Object.freeze(optional.sources[1]),
  ]);
  return Object.freeze({
    server,
    data,
    sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
