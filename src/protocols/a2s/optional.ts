/** Concurrent optional A2S source execution with explicit provenance. */

import type { QuerySource, QuerySourceName, QuerySourceStatus } from "../../contracts/shared.js";
import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import { UdpTransportError } from "../../transports/udp.js";
import { A2sProtocolError } from "./errors.js";
import type { A2sExchangeDependencies } from "./network.js";
import { queryA2sPlayer, type A2sPlayer } from "./player.js";
import { queryA2sRules, type A2sRules } from "./rules.js";

/** Whether an optional source should run or be represented as intentionally unavailable. */
export type A2sOptionalSourcePolicy = "query" | "blocked" | "unsupported" | "not-requested";

/** Inputs available after target resolution and the required A2S Info source have succeeded. */
export interface A2sOptionalSourcesOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
  /** Per-source budget; both independent operations remain capped by the root deadline. */
  readonly operationTimeoutMs: number;
  readonly player: A2sOptionalSourcePolicy;
  readonly rules: A2sOptionalSourcePolicy;
  /** Internal lifecycle hook used to preserve accurate whole-query provenance. */
  readonly onSourceStarted?: (source: QuerySourceName) => void;
  /** Internal lifecycle hook used to retain reports completed before whole-query termination. */
  readonly onSourceCompleted?: (report: QuerySource) => void;
}

/** Optional enrichment values and deterministic source reports. */
export interface A2sOptionalSourcesResult {
  /** Omitted on failure; an empty array means the server confirmed zero listed players. */
  readonly players?: readonly A2sPlayer[];
  /** Omitted on failure; an empty object means the server confirmed zero rules. */
  readonly rules?: A2sRules;
  /** Always ordered as Player then Rules, independent of network completion order. */
  readonly sources: readonly [QuerySource, QuerySource];
}

interface PlayerOutcome {
  readonly report: QuerySource;
  readonly players?: readonly A2sPlayer[];
}

interface RulesOutcome {
  readonly report: QuerySource;
  readonly rules?: A2sRules;
}

function report(source: QuerySourceName, status: QuerySourceStatus, rttMs?: number): QuerySource {
  return rttMs === undefined ? { source, status } : { source, status, rttMs };
}

function policyReport(source: QuerySourceName, policy: A2sOptionalSourcePolicy): QuerySource {
  return report(source, policy === "query" ? "failed" : policy);
}

function complete(options: A2sOptionalSourcesOptions, outcome: PlayerOutcome): PlayerOutcome;
function complete(options: A2sOptionalSourcesOptions, outcome: RulesOutcome): RulesOutcome;
function complete(
  options: A2sOptionalSourcesOptions,
  outcome: PlayerOutcome | RulesOutcome,
): PlayerOutcome | RulesOutcome {
  options.onSourceCompleted?.(outcome.report);
  return outcome;
}

function failureStatus(error: Error): QuerySourceStatus {
  if (error instanceof A2sProtocolError) {
    return "malformed";
  }
  if (error instanceof UdpTransportError) {
    if (error.code === "TIMEOUT") {
      return "timeout";
    }
    if (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE") {
      return "malformed";
    }
  }
  return "failed";
}

function rootTermination(scope: ExecutionScope): UdpTransportError {
  return new UdpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function runPlayer(
  options: A2sOptionalSourcesOptions,
  dependencies?: A2sExchangeDependencies,
): Promise<PlayerOutcome> {
  const source = "a2s-player";
  if (options.player !== "query") {
    return complete(options, { report: policyReport(source, options.player) });
  }
  options.onSourceStarted?.(source);
  const scope = options.scope.createOperation(options.operationTimeoutMs, source);
  try {
    const result = await queryA2sPlayer(
      { scope, target: options.target, address: options.address },
      dependencies,
    );
    return complete(options, {
      report: report(source, "ok", result.rttMs),
      players: result.players,
    });
  } catch (error) {
    if (options.scope.signal.aborted) {
      throw rootTermination(options.scope);
    }
    return complete(options, {
      report: report(source, error instanceof Error ? failureStatus(error) : "failed"),
    });
  } finally {
    scope.close();
  }
}

async function runRules(
  options: A2sOptionalSourcesOptions,
  dependencies?: A2sExchangeDependencies,
): Promise<RulesOutcome> {
  const source = "a2s-rules";
  if (options.rules !== "query") {
    return complete(options, { report: policyReport(source, options.rules) });
  }
  options.onSourceStarted?.(source);
  const scope = options.scope.createOperation(options.operationTimeoutMs, source);
  try {
    const result = await queryA2sRules(
      { scope, target: options.target, address: options.address },
      dependencies,
    );
    return complete(options, { report: report(source, "ok", result.rttMs), rules: result.rules });
  } catch (error) {
    if (options.scope.signal.aborted) {
      throw rootTermination(options.scope);
    }
    return complete(options, {
      report: report(source, error instanceof Error ? failureStatus(error) : "failed"),
    });
  } finally {
    scope.close();
  }
}

/** Runs independent requested sources concurrently without promoting optional failure to failure. */
export async function queryA2sOptionalSources(
  options: A2sOptionalSourcesOptions,
  dependencies?: A2sExchangeDependencies,
): Promise<A2sOptionalSourcesResult> {
  if (!Number.isSafeInteger(options.operationTimeoutMs) || options.operationTimeoutMs <= 0) {
    throw new RangeError("The optional A2S source timeout must be a positive safe integer.");
  }
  const [player, rules] = await Promise.all([
    runPlayer(options, dependencies),
    runRules(options, dependencies),
  ]);
  const sources: readonly [QuerySource, QuerySource] = Object.freeze([player.report, rules.report]);
  return Object.freeze({
    ...(player.players === undefined ? {} : { players: player.players }),
    ...(rules.rules === undefined ? {} : { rules: rules.rules }),
    sources,
  });
}
