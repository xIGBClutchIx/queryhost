/** Satisfactory profile over its lightweight UDP query and optional HTTPS health check. */

import type { SatisfactoryData, SatisfactoryRawData } from "../contracts/games.js";
import type {
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedAddress, PinnedTarget } from "../network/target.js";
import {
  querySatisfactoryHealth,
  querySatisfactoryLightweight,
  type SatisfactoryHealthResult,
  type SatisfactoryLightweightResult,
  type SatisfactoryQueryDependencies,
} from "../protocols/satisfactory/query.js";
import { SatisfactoryProtocolError } from "../protocols/satisfactory/errors.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { raceAttempts } from "../runtime/attempt-race.js";
import { HttpTransportError } from "../transports/http.js";
import { UdpTransportError } from "../transports/udp.js";

const SOURCE_TIMEOUT_MS = 2_000;

export interface SatisfactoryProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

export interface SatisfactoryProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly mode: "summary" | "full";
  readonly observer: SatisfactoryProfileObserver;
  readonly query?: SatisfactoryQueryDependencies;
  readonly random?: () => number;
}

export interface SatisfactoryProfileResult {
  readonly server: ServerInfo;
  readonly data: SatisfactoryData;
  readonly rawData: SatisfactoryRawData;
  readonly sources: readonly [QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function randomWord(random: () => number): bigint {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new SatisfactoryProtocolError("INVALID_INPUT");
  }
  return BigInt(Math.floor(value * 0x1_0000_0000));
}

/** Generates the correlation cookie used to reject unrelated UDP responses. */
export function createSatisfactoryCookie(random: () => number): bigint {
  return (randomWord(random) << 32n) | randomWord(random);
}

function terminationCode(scope: ExecutionScope): "TIMEOUT" | "ABORTED" {
  return scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED";
}

async function lightweight(
  options: SatisfactoryProfileOptions,
  cookie: bigint,
): Promise<{ readonly result: SatisfactoryLightweightResult; readonly address: PinnedAddress }> {
  options.observer.onSourceStarted("satisfactory-lightweight");
  const { candidate: address, value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: SOURCE_TIMEOUT_MS,
      source: "satisfactory-lightweight",
      terminated: () => new UdpTransportError(terminationCode(options.scope)),
      empty: () => new Error("Satisfactory target had no validated addresses."),
    },
    (address, operation) =>
      querySatisfactoryLightweight(
        { scope: operation, target: options.target, address },
        cookie,
        options.query,
      ),
  );
  const report: QuerySource = Object.freeze({
    source: "satisfactory-lightweight",
    status: "ok",
    rttMs: result.rttMs,
  });
  options.observer.onSourceCompleted(report);
  return Object.freeze({ result, address });
}

function optionalStatus(error: Error): QuerySource["status"] {
  if (error instanceof HttpTransportError) {
    if (error.code === "TIMEOUT") return "timeout";
    if (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE") {
      return "malformed";
    }
  }
  if (error instanceof SatisfactoryProtocolError) return "malformed";
  return "failed";
}

function warning(report: QuerySource): QueryWarning {
  if (report.status === "timeout") {
    return Object.freeze({
      code: "SOURCE_TIMEOUT",
      message: "The optional Satisfactory HTTPS health check timed out.",
      source: report.source,
    });
  }
  if (report.status === "malformed") {
    return Object.freeze({
      code: "SOURCE_MALFORMED",
      message: "The optional Satisfactory HTTPS health check returned malformed data.",
      source: report.source,
    });
  }
  return Object.freeze({
    code: "SOURCE_FAILED",
    message: "The optional Satisfactory HTTPS health check failed.",
    source: report.source,
  });
}

async function health(
  options: SatisfactoryProfileOptions,
  address: PinnedAddress,
): Promise<{ readonly result?: SatisfactoryHealthResult; readonly report: QuerySource }> {
  options.observer.onSourceStarted("satisfactory-health");
  const operation = options.scope.createOperation(SOURCE_TIMEOUT_MS, "satisfactory-health");
  try {
    const result = await querySatisfactoryHealth(
      { scope: operation, target: options.target, address },
      options.query,
    );
    return Object.freeze({
      result,
      report: Object.freeze({ source: "satisfactory-health", status: "ok", rttMs: result.rttMs }),
    });
  } catch (error) {
    if (options.scope.signal.aborted) throw new HttpTransportError(terminationCode(options.scope));
    const stable = error instanceof Error ? error : new Error("Satisfactory health check failed.");
    return Object.freeze({
      report: Object.freeze({ source: "satisfactory-health", status: optionalStatus(stable) }),
    });
  } finally {
    operation.close();
  }
}

/** Queries one validated Satisfactory server without requesting authentication credentials. */
export async function querySatisfactoryProfile(
  options: SatisfactoryProfileOptions,
): Promise<SatisfactoryProfileResult> {
  const primary = await lightweight(
    options,
    createSatisfactoryCookie(options.random ?? Math.random),
  );
  const lightweightReport: QuerySource = Object.freeze({
    source: "satisfactory-lightweight",
    status: "ok",
    rttMs: primary.result.rttMs,
  });
  let healthResult: SatisfactoryHealthResult | undefined;
  let healthReport: QuerySource;
  if (options.mode === "summary" || primary.result.value.state === "loading") {
    healthReport = Object.freeze({ source: "satisfactory-health", status: "not-requested" });
  } else {
    const optional = await health(options, primary.address);
    healthResult = optional.result;
    healthReport = optional.report;
  }
  options.observer.onSourceCompleted(healthReport);
  const sources: readonly [QuerySource, QuerySource] = Object.freeze([
    lightweightReport,
    healthReport,
  ]);
  const warnings: readonly QueryWarning[] =
    healthReport.status === "ok" || healthReport.status === "not-requested"
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            code: "PARTIAL_RESULT",
            message: "The optional Satisfactory HTTPS status source did not complete.",
          }),
          warning(healthReport),
        ]);
  const status = primary.result.value;
  return Object.freeze({
    server: Object.freeze({
      name: status.serverName,
      version: String(status.serverNetCl),
      queryRttMs: primary.result.rttMs,
    }),
    data: Object.freeze({
      state: status.state,
      serverNetCl: status.serverNetCl,
      modded: status.modded,
      ...(healthResult === undefined ? {} : { health: healthResult.value.health }),
    }),
    rawData: Object.freeze({
      stateCode: status.stateCode,
      serverFlags: status.serverFlags,
      subStates: status.subStates,
      ...(healthResult === undefined ? {} : { health: healthResult.value }),
    }),
    sources,
    warnings,
    partial: warnings.length > 0,
  });
}
