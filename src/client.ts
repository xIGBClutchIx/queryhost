/** Public query orchestration over validated targets and implemented game profiles. */

import { executeWithDeadline, type ExecutionScope } from "./execution.js";
import type { GameId, QueryFailure, QueryInput, QueryResult, QuerySuccess } from "./query.js";
import { GAME_REGISTRY } from "./registry.js";
import type {
  QueryError,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
} from "./shared.js";
import {
  resolveTarget,
  validatePort,
  TargetResolutionError,
  type DnsResolver,
  type PinnedTarget,
} from "./target.js";
import { UdpTransportError } from "./transports/udp.js";
import { A2sProtocolError } from "./protocols/a2s/errors.js";
import type { A2sExchangeDependencies } from "./protocols/a2s/network.js";
import {
  queryRustProfile,
  type RustProfileObserver,
  type RustProfileResult,
} from "./profiles/rust.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const INPUT_ERROR: QueryError = Object.freeze({
  code: "INVALID_INPUT",
  message: "The query input is invalid.",
});
const UNSUPPORTED_ERROR: QueryError = Object.freeze({
  code: "UNSUPPORTED_GAME",
  message: "The requested game profile is not implemented.",
});

/** Injectable boundaries used by deterministic end-to-end profile tests. */
export interface QueryDependencies {
  readonly resolver?: DnsResolver;
  readonly a2s?: A2sExchangeDependencies;
  readonly now: () => number;
}

interface SourceTrace {
  readonly started: Set<QuerySourceName>;
  readonly completed: Map<QuerySourceName, QuerySource>;
}

type RustTaskResult =
  | { readonly ok: true; readonly profile: RustProfileResult }
  | { readonly ok: false; readonly error: QueryError };

const DEFAULT_DEPENDENCIES: QueryDependencies = {
  now: (): number => performance.now(),
};

function duration(startedAt: number, dependencies: QueryDependencies): number {
  return Math.max(0, dependencies.now() - startedAt);
}

function frozenSources(sources: readonly QuerySource[]): readonly QuerySource[] {
  return Object.freeze(sources.map((source) => Object.freeze(source)));
}

function failure<G extends GameId>(
  game: G,
  error: QueryError,
  durationMs: number,
  sources: readonly QuerySource[] = [],
): QueryFailure<G> {
  return Object.freeze({
    ok: false,
    game,
    error: Object.freeze(error),
    durationMs,
    sources: frozenSources(sources),
    warnings: Object.freeze([]),
  });
}

function failureForGame(
  game: GameId,
  error: QueryError,
  durationMs: number,
  sources: readonly QuerySource[] = [],
): QueryResult {
  switch (game) {
    case "rust":
      return failure(game, error, durationMs, sources);
    case "project-zomboid":
      return failure(game, error, durationMs, sources);
    case "7-days-to-die":
      return failure(game, error, durationMs, sources);
    case "minecraft-java":
      return failure(game, error, durationMs, sources);
    case "minecraft-bedrock":
      return failure(game, error, durationMs, sources);
    case "fivem":
      return failure(game, error, durationMs, sources);
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new RangeError("Invalid query timeout.");
  }
  return value;
}

function normalizeMode(mode: string | undefined): QueryMode {
  if (mode !== undefined && mode !== "summary" && mode !== "full") {
    throw new RangeError("Invalid query mode.");
  }
  return mode ?? "full";
}

function validateInput(input: QueryInput): void {
  if (input.port !== undefined) {
    validatePort(input.port);
  }
  if (input.queryPort !== undefined) {
    validatePort(input.queryPort);
  }
}

function queryPort(input: QueryInput): number {
  if (input.queryPort !== undefined) {
    return input.queryPort;
  }
  const definition = GAME_REGISTRY[input.game];
  const gamePort = input.port ?? definition.defaultPort;
  const queryPortOffset =
    (definition.defaultQueryPort ?? definition.defaultPort) - definition.defaultPort;
  return validatePort(gamePort + queryPortOffset);
}

async function pinnedTarget(
  input: QueryInput,
  dependencies: QueryDependencies,
): Promise<PinnedTarget> {
  const targetInput = { host: input.host, port: queryPort(input) };
  return dependencies.resolver === undefined
    ? resolveTarget(targetInput)
    : resolveTarget(targetInput, dependencies.resolver);
}

function protocolError(error: A2sProtocolError): QueryError {
  const code =
    error.code === "RESPONSE_TOO_LARGE"
      ? "RESPONSE_TOO_LARGE"
      : error.code === "INVALID_INPUT"
        ? "INVALID_INPUT"
        : "MALFORMED_RESPONSE";
  const message =
    code === "RESPONSE_TOO_LARGE"
      ? "The A2S response exceeded its size limit."
      : code === "INVALID_INPUT"
        ? "The A2S query input is invalid."
        : "The A2S response was malformed.";
  return { code, message, source: "a2s-info" };
}

function mapQueryError(error: Error): QueryError | undefined {
  if (error instanceof TargetResolutionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof UdpTransportError) {
    return { code: error.code, message: error.message, source: "a2s-info" };
  }
  if (error instanceof A2sProtocolError) {
    return protocolError(error);
  }
  return undefined;
}

function sourceStatus(error: QueryError): QuerySourceStatus {
  if (error.code === "TIMEOUT") {
    return "timeout";
  }
  if (error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE") {
    return "malformed";
  }
  return "failed";
}

function traceSources(trace: SourceTrace, terminalError?: QueryError): readonly QuerySource[] {
  const order: readonly QuerySourceName[] = ["a2s-info", "a2s-player", "a2s-rules"];
  const sources: QuerySource[] = [];
  for (const source of order) {
    const completed = trace.completed.get(source);
    if (completed !== undefined) {
      sources.push(completed);
    } else if (trace.started.has(source)) {
      sources.push({
        source,
        status:
          terminalError?.code === "TIMEOUT"
            ? "timeout"
            : terminalError === undefined
              ? "failed"
              : sourceStatus(terminalError),
      });
    }
  }
  return sources;
}

function observer(trace: SourceTrace): RustProfileObserver {
  return {
    onSourceStarted(source): void {
      trace.started.add(source);
    },
    onSourceCompleted(report): void {
      trace.completed.set(report.source, report);
    },
  };
}

async function runRustTask(
  input: QueryInput,
  mode: QueryMode,
  scope: ExecutionScope,
  trace: SourceTrace,
  dependencies: QueryDependencies,
): Promise<RustTaskResult> {
  try {
    const target = await pinnedTarget(input, dependencies);
    const profile = await queryRustProfile({
      scope,
      target,
      mode,
      observer: observer(trace),
      ...(dependencies.a2s === undefined ? {} : { a2s: dependencies.a2s }),
    });
    return { ok: true, profile };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const mapped = mapQueryError(error);
    if (mapped === undefined) {
      throw error;
    }
    return { ok: false, error: mapped };
  }
}

function rustSuccess(profile: RustProfileResult, durationMs: number): QuerySuccess<"rust"> {
  return Object.freeze({
    ok: true,
    game: "rust",
    server: profile.server,
    data: profile.data,
    sources: profile.sources,
    partial: profile.partial,
    warnings: profile.warnings,
    durationMs,
  });
}

/** Internal dependency-injected form of {@link query}; not exported from the package root. */
export async function queryWithDependencies(
  input: QueryInput,
  dependencies: QueryDependencies,
): Promise<QueryResult> {
  const startedAt = dependencies.now();
  if (input.game !== "rust") {
    return failureForGame(input.game, UNSUPPORTED_ERROR, duration(startedAt, dependencies));
  }

  let timeoutMs: number;
  let mode: QueryMode;
  try {
    timeoutMs = normalizeTimeout(input.timeoutMs);
    mode = normalizeMode(input.mode);
    validateInput(input);
  } catch {
    return failure(input.game, INPUT_ERROR, duration(startedAt, dependencies));
  }

  const trace: SourceTrace = { started: new Set(), completed: new Map() };
  const execution = await executeWithDeadline(
    {
      timeoutMs,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
    (scope) => runRustTask(input, mode, scope, trace, dependencies),
  );
  const durationMs = duration(startedAt, dependencies);
  if (!execution.ok) {
    return failure(input.game, execution.error, durationMs, traceSources(trace, execution.error));
  }
  if (!execution.value.ok) {
    return failure(
      input.game,
      execution.value.error,
      durationMs,
      traceSources(trace, execution.value.error),
    );
  }
  return rustSuccess(execution.value.profile, durationMs);
}

/** Queries one game server through its typed QueryHost profile. */
export function query<G extends GameId>(input: QueryInput<G>): Promise<QueryResult<G>> {
  return queryWithDependencies(input, DEFAULT_DEPENDENCIES) as Promise<QueryResult<G>>;
}
