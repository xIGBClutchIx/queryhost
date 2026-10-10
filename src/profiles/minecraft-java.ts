/** Minecraft Java discovery, required SLP with legacy fallback, and optional UDP Query. */

import { isIP } from "node:net";

import type { MinecraftJavaData, MinecraftSrvTarget } from "../contracts/games.js";
import { javaCrossplay } from "./minecraft-crossplay.js";
import { OutboundAttemptLimitError, type ExecutionScope } from "../runtime/execution.js";
import { raceAttempts, type AttemptRaceWin } from "../runtime/attempt-race.js";
import { MinecraftJavaProtocolError } from "../protocols/minecraft-java/errors.js";
import {
  queryMinecraftLegacyStatus,
  type MinecraftJavaLegacyStatus,
} from "../protocols/minecraft-java/legacy.js";
import {
  createMinecraftQuerySessionId,
  queryMinecraftFullStat,
  type MinecraftQueryDependencies,
  type MinecraftQueryResult,
} from "../protocols/minecraft-java/query.js";
import {
  queryMinecraftStatus,
  type MinecraftJavaStatus,
  type MinecraftJavaStatusDependencies,
} from "../protocols/minecraft-java/status.js";
import type {
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
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
} from "../network/target.js";
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
  readonly resolver: DnsResolver;
  readonly random?: SrvRandomSource;
  /** TCP boundaries shared by the modern status ping and its legacy fallback. */
  readonly status?: MinecraftJavaStatusDependencies;
  readonly query?: MinecraftQueryDependencies;
}

/** Fully merged Minecraft Java result before the public query envelope is added. */
export interface MinecraftJavaProfileResult {
  readonly server: ServerInfo;
  readonly data: MinecraftJavaData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

interface MinecraftCandidate {
  readonly target: PinnedTarget;
  readonly srv?: MinecraftSrvTarget;
  /** SRV priority; omitted for direct targets, which form a single group. */
  readonly priority?: number;
}

interface StatusAttempt {
  readonly candidate: MinecraftCandidate;
  readonly address: PinnedAddress;
}

interface DiscoveryResult {
  readonly candidates: readonly MinecraftCandidate[];
  readonly report: QuerySource;
}

/** Status facts from whichever ping answered; the legacy ping cannot confirm every field. */
type PingStatus = MinecraftJavaStatus | MinecraftJavaLegacyStatus;

interface PingResult {
  readonly status: PingStatus;
  readonly rttMs: number;
}

interface StatusSuccess {
  readonly result: PingResult;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  readonly srv?: MinecraftSrvTarget;
  readonly slp: QuerySource;
  readonly legacy: QuerySource;
}

/** One address's answer; `modernStatus` is set when SLP failed and the legacy ping answered. */
interface PingAnswer {
  readonly result: PingResult;
  readonly modernStatus?: QuerySourceStatus;
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
  scope: ExecutionScope,
  resolver: DnsResolver,
): Promise<PinnedTarget> {
  const input = { host, port };
  return resolveTarget(input, scope, resolver);
}

async function srvTargets(
  host: string,
  scope: ExecutionScope,
  resolver: DnsResolver,
): Promise<Awaited<ReturnType<typeof resolveSrvTargets>>> {
  const input = { service: "minecraft", protocol: "tcp", host } as const;
  return resolveSrvTargets(input, scope, resolver);
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
      candidates: Object.freeze([
        { target: await directTarget(hostname, port, options.scope, options.resolver) },
      ]),
      report,
    });
  }

  options.observer.onSourceStarted("minecraft-srv");
  const records = await srvTargets(hostname, options.scope, options.resolver);
  if (records.length === 0) {
    const report: QuerySource = Object.freeze({ source: "minecraft-srv", status: "unsupported" });
    options.observer.onSourceCompleted(report);
    return Object.freeze({
      candidates: Object.freeze([
        { target: await directTarget(hostname, DEFAULT_PORT, options.scope, options.resolver) },
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
          priority: record.priority,
        }),
      ),
    ),
    report,
  });
}

function attemptGroups(candidates: readonly MinecraftCandidate[]): readonly StatusAttempt[][] {
  // Candidates arrive in SRV order. Addresses race within one priority group; a higher-numbered
  // priority is a backup and starts only after every target in the preferred group has failed.
  const groups: StatusAttempt[][] = [];
  let groupPriority: number | undefined;
  for (const candidate of candidates) {
    const attempts = candidate.target.addresses.map((address) => ({ candidate, address }));
    const current = groups.at(-1);
    if (current === undefined || candidate.priority !== groupPriority) {
      groups.push(attempts);
      groupPriority = candidate.priority;
    } else {
      current.push(...attempts);
    }
  }
  return groups;
}

function fallbackStatus(error: Error): QuerySourceStatus | undefined {
  if (error instanceof TcpTransportError) {
    if (error.code === "TIMEOUT") {
      return "timeout";
    }
    if (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE") {
      return "malformed";
    }
    return error.code === "CONNECTION_FAILED" ? "failed" : undefined;
  }
  if (error instanceof MinecraftJavaProtocolError) {
    return error.code === "INVALID_INPUT" ? undefined : "malformed";
  }
  return undefined;
}

/** Legacy fallback progress shared by every concurrent address attempt. */
interface LegacyTrace {
  started: boolean;
  lastStatus?: QuerySourceStatus;
}

/**
 * Pre-1.7 servers drop or reject the modern handshake, so an address whose status ping was
 * closed, refused, or answered with unparseable bytes is retried at once with the legacy ping,
 * inside the same attempt. Deciding per address keeps one hanging sibling from masking a legacy
 * server, keeps a preferred SRV group's legacy server ahead of its backups, and spends extra
 * outbound attempts only on addresses that actually rejected SLP. A timeout is not retried: a
 * legacy server answers or closes promptly, and retrying an unreachable host would double its
 * wait. When both pings fail, the attempt raises its modern error.
 */
async function pingAddress(
  options: MinecraftJavaProfileOptions,
  attempt: StatusAttempt,
  operation: ExecutionScope,
  legacy: LegacyTrace,
): Promise<PingAnswer> {
  const request = { scope: operation, target: attempt.candidate.target, address: attempt.address };
  let modernError: Error;
  try {
    return Object.freeze({ result: await queryMinecraftStatus(request, options.status) });
  } catch (error) {
    const modernStatus = error instanceof Error ? fallbackStatus(error) : undefined;
    if (
      operation.signal.aborted ||
      !(error instanceof Error) ||
      modernStatus === undefined ||
      modernStatus === "timeout"
    ) {
      throw error;
    }
    modernError = error;
    if (!legacy.started) {
      legacy.started = true;
      options.observer.onSourceStarted("minecraft-legacy-ping");
    }
    try {
      const result = await queryMinecraftLegacyStatus(request, options.status);
      return Object.freeze({ result, modernStatus });
    } catch (legacyError) {
      // An exhausted budget is the query's own failure, not this address's, so it keeps its
      // public contract instead of hiding behind the SLP error.
      if (legacyError instanceof OutboundAttemptLimitError) {
        legacy.lastStatus = "failed";
        throw legacyError;
      }
      // A winning sibling's cancellation says nothing about this ping, but this attempt's own
      // deadline is the ping timing out.
      if (!operation.signal.aborted) {
        legacy.lastStatus =
          (legacyError instanceof Error ? fallbackStatus(legacyError) : undefined) ?? "failed";
      } else if (operation.getError()?.code === "TIMEOUT") {
        legacy.lastStatus = "timeout";
      }
    }
  }
  throw modernError;
}

async function requiredStatus(
  options: MinecraftJavaProfileOptions,
  candidates: readonly MinecraftCandidate[],
): Promise<StatusSuccess> {
  options.observer.onSourceStarted("minecraft-slp");
  const legacy: LegacyTrace = { started: false };
  let win: AttemptRaceWin<StatusAttempt, PingAnswer> | undefined;
  let lastError: Error | undefined;
  for (const group of attemptGroups(candidates)) {
    try {
      win = await raceAttempts(
        {
          scope: options.scope,
          candidates: group,
          operationTimeoutMs: STATUS_OPERATION_TIMEOUT_MS,
          source: "minecraft-slp",
          terminated: () => rootTcpTermination(options.scope),
          empty: () => new Error("Minecraft Java discovery produced no addresses."),
        },
        (attempt, operation) => pingAddress(options, attempt, operation, legacy),
      );
      break;
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootTcpTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("Minecraft Java status failed.");
    }
  }
  if (win === undefined) {
    if (legacy.started) {
      options.observer.onSourceCompleted(
        Object.freeze({
          source: "minecraft-legacy-ping",
          status: legacy.lastStatus ?? "failed",
        }),
      );
    }
    throw lastError ?? new Error("Minecraft Java discovery produced no addresses.");
  }

  // Reports describe the attempt that answered: SLP keeps that address's own failure when the
  // legacy ping answered it. Once an address answered SLP the legacy ping was not needed, unless a
  // sibling had already started one, which then reports how it ended or that it was cut short.
  const answer = win.value;
  const slp: QuerySource = Object.freeze(
    answer.modernStatus === undefined
      ? { source: "minecraft-slp", status: "ok", rttMs: answer.result.rttMs }
      : { source: "minecraft-slp", status: answer.modernStatus },
  );
  const legacyReport: QuerySource = Object.freeze(
    answer.modernStatus !== undefined
      ? { source: "minecraft-legacy-ping", status: "ok", rttMs: answer.result.rttMs }
      : legacy.started
        ? { source: "minecraft-legacy-ping", status: legacy.lastStatus ?? "failed" }
        : { source: "minecraft-legacy-ping", status: "not-requested" },
  );
  options.observer.onSourceCompleted(slp);
  options.observer.onSourceCompleted(legacyReport);
  const { candidate, address } = win.candidate;
  return Object.freeze({
    result: answer.result,
    target: candidate.target,
    address,
    ...(candidate.srv === undefined ? {} : { srv: candidate.srv }),
    slp,
    legacy: legacyReport,
  });
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

/**
 * Resolves Minecraft discovery, queries required SLP (falling back to the legacy ping), and
 * optionally enriches with UDP Query.
 */
export async function queryMinecraftJavaProfile(
  options: MinecraftJavaProfileOptions,
): Promise<MinecraftJavaProfileResult> {
  const discovery = await discover(options);
  const status = await requiredStatus(options, discovery.candidates);
  const query = await optionalQuery(options, status);
  const value = status.result.status;
  const favicon = "favicon" in value ? value.favicon : undefined;
  const queryStat = query.result?.stat;
  const server: ServerInfo = Object.freeze({
    ...(queryStat?.map === undefined ? {} : { map: queryStat.map }),
    ...(value.versionName === undefined ? {} : { version: value.versionName }),
    players: Object.freeze({ online: value.playersOnline, max: value.playersMax }),
    queryRttMs: status.result.rttMs,
  });
  const data: MinecraftJavaData = Object.freeze({
    motd: value.motd,
    ...(value.protocolVersion === undefined ? {} : { protocolVersion: value.protocolVersion }),
    ...(favicon === undefined ? {} : { favicon }),
    ...(status.srv === undefined ? {} : { srv: status.srv }),
    ...(queryStat?.software === undefined ? {} : { software: queryStat.software }),
    ...(queryStat?.plugins === undefined ? {} : { plugins: queryStat.plugins }),
    ...(queryStat?.players === undefined ? {} : { players: queryStat.players }),
    ...javaCrossplay(queryStat?.plugins),
  });
  const sources: readonly [QuerySource, QuerySource, QuerySource, QuerySource] = Object.freeze([
    discovery.report,
    status.slp,
    status.legacy,
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
