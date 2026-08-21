/** Minecraft Java discovery, required SLP, and optional UDP Query orchestration. */

import { isIP } from "node:net";

import type { ExecutionScope } from "../execution.js";
import type { MinecraftJavaData, MinecraftSrvTarget } from "../games.js";
import { MinecraftJavaProtocolError } from "../protocols/minecraft-java/errors.js";
import {
  createMinecraftQuerySessionId,
  queryMinecraftFullStat,
  type MinecraftQueryDependencies,
  type MinecraftQueryResult,
} from "../protocols/minecraft-java/query.js";
import {
  queryMinecraftStatus,
  type MinecraftJavaStatusDependencies,
  type MinecraftJavaStatusQueryResult,
} from "../protocols/minecraft-java/status.js";
import type {
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  ServerInfo,
} from "../shared.js";
import {
  normalizeHostname,
  orderSrvTargets,
  resolveSrvTargets,
  resolveTarget,
  validatePort,
  type DnsResolver,
  type PinnedAddress,
  type PinnedTarget,
  type SrvRandomSource,
} from "../target.js";
import { TcpTransportError } from "../transports/tcp.js";
import { UdpTransportError } from "../transports/udp.js";

const STATUS_OPERATION_TIMEOUT_MS = 2_000;
const QUERY_OPERATION_TIMEOUT_MS = 1_500;
const DEFAULT_PORT = 25_565;

/** Source lifecycle observer used by whole-query provenance. */
export interface MinecraftJavaProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available to Minecraft Java discovery and protocol sources. */
export interface MinecraftJavaProfileOptions {
  readonly scope: ExecutionScope;
  readonly host: string;
  readonly port?: number;
  readonly queryPort?: number;
  readonly mode: QueryMode;
  readonly observer: MinecraftJavaProfileObserver;
  readonly resolver?: DnsResolver;
  readonly random?: SrvRandomSource;
  readonly status?: MinecraftJavaStatusDependencies;
  readonly query?: MinecraftQueryDependencies;
}

/** Fully merged Minecraft Java result before the public query envelope is added. */
export interface MinecraftJavaProfileResult {
  readonly server: ServerInfo;
  readonly data: MinecraftJavaData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

interface MinecraftCandidate {
  readonly target: PinnedTarget;
  readonly srv?: MinecraftSrvTarget;
}

interface DiscoveryResult {
  readonly candidates: readonly MinecraftCandidate[];
  readonly report: QuerySource;
}

interface StatusSuccess {
  readonly result: MinecraftJavaStatusQueryResult;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  readonly srv?: MinecraftSrvTarget;
  readonly report: QuerySource;
}

interface OptionalQueryResult {
  readonly result?: MinecraftQueryResult;
  readonly report: QuerySource;
}

function rootTcpTermination(scope: ExecutionScope): TcpTransportError {
  return new TcpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

function rootUdpTermination(scope: ExecutionScope): UdpTransportError {
  return new UdpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function directTarget(
  host: string,
  port: number,
  resolver: DnsResolver | undefined,
): Promise<PinnedTarget> {
  const input = { host, port };
  return resolver === undefined ? resolveTarget(input) : resolveTarget(input, resolver);
}

async function srvTargets(
  host: string,
  resolver: DnsResolver | undefined,
): Promise<Awaited<ReturnType<typeof resolveSrvTargets>>> {
  const input = { service: "minecraft", protocol: "tcp", host } as const;
  return resolver === undefined ? resolveSrvTargets(input) : resolveSrvTargets(input, resolver);
}

async function discover(options: MinecraftJavaProfileOptions): Promise<DiscoveryResult> {
  const hostname = normalizeHostname(options.host);
  const port = validatePort(options.port ?? DEFAULT_PORT);
  if (options.port !== undefined || isIP(hostname) !== 0) {
    const report: QuerySource = Object.freeze({
      source: "minecraft-srv",
      status: "not-requested",
    });
    options.observer.onSourceCompleted(report);
    return Object.freeze({
      candidates: Object.freeze([{ target: await directTarget(hostname, port, options.resolver) }]),
      report,
    });
  }

  options.observer.onSourceStarted("minecraft-srv");
  const records = await srvTargets(hostname, options.resolver);
  if (records.length === 0) {
    const report: QuerySource = Object.freeze({ source: "minecraft-srv", status: "unsupported" });
    options.observer.onSourceCompleted(report);
    return Object.freeze({
      candidates: Object.freeze([
        { target: await directTarget(hostname, DEFAULT_PORT, options.resolver) },
      ]),
      report,
    });
  }

  const ordered = orderSrvTargets(records, options.random);
  const report: QuerySource = Object.freeze({ source: "minecraft-srv", status: "ok" });
  options.observer.onSourceCompleted(report);
  return Object.freeze({
    candidates: Object.freeze(
      ordered.map((record) =>
        Object.freeze({
          target: record.target,
          srv: Object.freeze({ host: record.target.hostname, port: record.target.port }),
        }),
      ),
    ),
    report,
  });
}

async function requiredStatus(
  options: MinecraftJavaProfileOptions,
  candidates: readonly MinecraftCandidate[],
): Promise<StatusSuccess> {
  options.observer.onSourceStarted("minecraft-slp");
  let lastError: Error | undefined;
  for (const candidate of candidates) {
    for (const address of candidate.target.addresses) {
      const operation = options.scope.createOperation(STATUS_OPERATION_TIMEOUT_MS, "minecraft-slp");
      try {
        const result = await queryMinecraftStatus(
          { scope: operation, target: candidate.target, address },
          options.status,
        );
        const report: QuerySource = Object.freeze({
          source: "minecraft-slp",
          status: "ok",
          rttMs: result.rttMs,
        });
        options.observer.onSourceCompleted(report);
        return Object.freeze({
          result,
          target: candidate.target,
          address,
          ...(candidate.srv === undefined ? {} : { srv: candidate.srv }),
          report,
        });
      } catch (error) {
        if (options.scope.signal.aborted) {
          throw rootTcpTermination(options.scope);
        }
        lastError = error instanceof Error ? error : new Error("Minecraft Java status failed.");
      } finally {
        operation.close();
      }
    }
  }
  throw lastError ?? new Error("Minecraft Java discovery produced no addresses.");
}

function queryTarget(status: StatusSuccess, explicitPort: number | undefined): PinnedTarget {
  if (explicitPort === undefined || explicitPort === status.target.port) {
    return status.target;
  }
  return Object.freeze({
    hostname: status.target.hostname,
    port: validatePort(explicitPort),
    addresses: status.target.addresses,
  });
}

function optionalStatus(error: Error): QuerySourceStatus {
  if (error instanceof UdpTransportError) {
    if (error.code === "TIMEOUT") {
      return "timeout";
    }
    if (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE") {
      return "malformed";
    }
    return "failed";
  }
  if (error instanceof MinecraftJavaProtocolError) {
    return error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"
      ? "malformed"
      : "failed";
  }
  return "failed";
}

async function optionalQuery(
  options: MinecraftJavaProfileOptions,
  status: StatusSuccess,
): Promise<OptionalQueryResult> {
  if (options.mode === "summary") {
    const report: QuerySource = Object.freeze({
      source: "minecraft-query",
      status: "not-requested",
    });
    options.observer.onSourceCompleted(report);
    return Object.freeze({ report });
  }

  options.observer.onSourceStarted("minecraft-query");
  const target = queryTarget(status, options.queryPort);
  const addresses = [
    status.address,
    ...target.addresses.filter(
      (address) =>
        address.address !== status.address.address || address.family !== status.address.family,
    ),
  ];
  let lastError: Error | undefined;
  for (const address of addresses) {
    const operation = options.scope.createOperation(QUERY_OPERATION_TIMEOUT_MS, "minecraft-query");
    try {
      const result = await queryMinecraftFullStat(
        {
          scope: operation,
          target,
          address,
          sessionId: createMinecraftQuerySessionId(options.random ?? Math.random),
        },
        options.query,
      );
      const report: QuerySource = Object.freeze({
        source: "minecraft-query",
        status: "ok",
        rttMs: result.rttMs,
      });
      options.observer.onSourceCompleted(report);
      return Object.freeze({ result, report });
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootUdpTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("Minecraft Query failed.");
    } finally {
      operation.close();
    }
  }
  const report: QuerySource = Object.freeze({
    source: "minecraft-query",
    status: optionalStatus(lastError ?? new Error("Minecraft Query had no addresses.")),
  });
  options.observer.onSourceCompleted(report);
  return Object.freeze({ report });
}

function queryWarnings(source: QuerySource): readonly QueryWarning[] {
  if (source.status === "ok" || source.status === "not-requested") {
    return Object.freeze([]);
  }
  const warningCode =
    source.status === "timeout"
      ? "SOURCE_TIMEOUT"
      : source.status === "malformed"
        ? "SOURCE_MALFORMED"
        : "SOURCE_FAILED";
  const condition =
    source.status === "timeout"
      ? "timed out"
      : source.status === "malformed"
        ? "returned malformed data"
        : "failed";
  return Object.freeze([
    Object.freeze({
      code: "PARTIAL_RESULT",
      message: "The optional Minecraft Query source did not complete successfully.",
    }),
    Object.freeze({
      code: warningCode,
      message: `The optional Minecraft Query source ${condition}.`,
      source: "minecraft-query",
    }),
  ]);
}

/** Resolves Minecraft discovery, queries required SLP, and optionally enriches with UDP Query. */
export async function queryMinecraftJavaProfile(
  options: MinecraftJavaProfileOptions,
): Promise<MinecraftJavaProfileResult> {
  const discovery = await discover(options);
  const status = await requiredStatus(options, discovery.candidates);
  const query = await optionalQuery(options, status);
  const value = status.result.status;
  const queryStat = query.result?.stat;
  const server: ServerInfo = Object.freeze({
    ...(queryStat?.map === undefined ? {} : { map: queryStat.map }),
    version: value.versionName,
    players: Object.freeze({ online: value.playersOnline, max: value.playersMax }),
    queryRttMs: status.result.rttMs,
  });
  const data: MinecraftJavaData = Object.freeze({
    motd: value.motd,
    protocolVersion: value.protocolVersion,
    ...(value.favicon === undefined ? {} : { favicon: value.favicon }),
    ...(status.srv === undefined ? {} : { srv: status.srv }),
    ...(queryStat?.software === undefined ? {} : { software: queryStat.software }),
    ...(queryStat?.plugins === undefined ? {} : { plugins: queryStat.plugins }),
    ...(queryStat?.players === undefined ? {} : { players: queryStat.players }),
  });
  const sources: readonly [QuerySource, QuerySource, QuerySource] = Object.freeze([
    discovery.report,
    status.report,
    query.report,
  ]);
  const warnings = queryWarnings(query.report);
  return Object.freeze({
    server,
    data,
    sources,
    warnings,
    partial: warnings.length > 0,
  });
}
