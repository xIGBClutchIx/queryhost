/** Minecraft Java discovery, required SLP with legacy fallback, and optional UDP Query. */

import { isIP } from "node:net";

import type { MinecraftJavaData, MinecraftSrvTarget } from "../contracts/games.js";
import type { ExecutionScope } from "../runtime/execution.js";
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

interface PingWin {
  readonly result: PingResult;
  readonly attempt: StatusAttempt;
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

async function racePing(
  options: MinecraftJavaProfileOptions,
  groups: readonly StatusAttempt[][],
  source: "minecraft-slp" | "minecraft-legacy-ping",
): Promise<PingWin> {
  const ping = source === "minecraft-slp" ? queryMinecraftStatus : queryMinecraftLegacyStatus;
  let lastError: Error | undefined;
  for (const group of groups) {
    try {
      const win: AttemptRaceWin<StatusAttempt, PingResult> = await raceAttempts(
        {
          scope: options.scope,
          candidates: group,
          operationTimeoutMs: STATUS_OPERATION_TIMEOUT_MS,
          source,
          terminated: () => rootTcpTermination(options.scope),
          empty: () => new Error("Minecraft Java discovery produced no addresses."),
        },
        ({ candidate, address }, operation) =>
          ping({ scope: operation, target: candidate.target, address }, options.status),
      );
      return Object.freeze({ result: win.value, attempt: win.candidate });
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootTcpTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("Minecraft Java status failed.");
    }
  }
  throw lastError ?? new Error("Minecraft Java discovery produced no addresses.");
}

function requiredStatusReport(error: Error): QuerySourceStatus | undefined {
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

function statusSuccess(win: PingWin, slp: QuerySource, legacy: QuerySource): StatusSuccess {
  const { candidate, address } = win.attempt;
  return Object.freeze({
    result: win.result,
    target: candidate.target,
    address,
    ...(candidate.srv === undefined ? {} : { srv: candidate.srv }),
    slp,
    legacy,
  });
}

/**
 * Pre-1.7 servers drop or reject the modern handshake, so a status ping that the server closed,
 * refused, or answered with unparseable bytes is retried once with the legacy ping. A timeout is
 * not: a legacy server answers or closes promptly, and retrying an unreachable host would double
 * its wait. The modern error stays the query's error when both pings fail.
 */
async function requiredStatus(
  options: MinecraftJavaProfileOptions,
  candidates: readonly MinecraftCandidate[],
): Promise<StatusSuccess> {
  const groups = attemptGroups(candidates);
  options.observer.onSourceStarted("minecraft-slp");
  let modernError: Error;
  try {
    const win = await racePing(options, groups, "minecraft-slp");
    const slp: QuerySource = Object.freeze({
      source: "minecraft-slp",
      status: "ok",
      rttMs: win.result.rttMs,
    });
    options.observer.onSourceCompleted(slp);
    const legacy: QuerySource = Object.freeze({
      source: "minecraft-legacy-ping",
      status: "not-requested",
    });
    options.observer.onSourceCompleted(legacy);
    return statusSuccess(win, slp, legacy);
  } catch (error) {
    if (options.scope.signal.aborted || !(error instanceof Error)) {
      throw error;
    }
    modernError = error;
  }

  const modernStatus = requiredStatusReport(modernError);
  if (modernStatus === undefined || modernStatus === "timeout") {
    throw modernError;
  }
  const slp: QuerySource = Object.freeze({ source: "minecraft-slp", status: modernStatus });
  options.observer.onSourceCompleted(slp);
  options.observer.onSourceStarted("minecraft-legacy-ping");
  let win: PingWin;
  try {
    win = await racePing(options, groups, "minecraft-legacy-ping");
  } catch (error) {
    if (options.scope.signal.aborted || !(error instanceof Error)) {
      throw error;
    }
    options.observer.onSourceCompleted(
      Object.freeze({
        source: "minecraft-legacy-ping",
        status: requiredStatusReport(error) ?? "failed",
      }),
    );
    throw modernError;
  }
  const legacy: QuerySource = Object.freeze({
    source: "minecraft-legacy-ping",
    status: "ok",
    rttMs: win.result.rttMs,
  });
  options.observer.onSourceCompleted(legacy);
  return statusSuccess(win, slp, legacy);
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
