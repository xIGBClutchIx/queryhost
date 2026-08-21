/** Public query orchestration over validated targets and implemented game profiles. */

import { executeWithDeadline, type ExecutionScope } from "./execution.js";
import type {
  CanonicalGameId,
  GameDataMap,
  GameId,
  GameRawDataMap,
  GameInputId,
  QueryFailure,
  QueryInput,
  QueryResult,
  QuerySuccess,
} from "./query.js";
import { canonicalGameId, GAME_REGISTRY } from "./registry.js";
import type {
  QueryError,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  ServerInfo,
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
import type { A2sProfileObserver, A2sProfileOptions } from "./profiles/a2s.js";
import { queryProjectZomboidProfile } from "./profiles/project-zomboid.js";
import { queryRustProfile } from "./profiles/rust.js";
import { querySevenDaysToDieProfile } from "./profiles/seven-days-to-die.js";

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

type ImplementedGame = "rust" | "project-zomboid" | "7-days-to-die";

interface GameProfileResult<G extends ImplementedGame> {
  readonly server: ServerInfo;
  readonly data: GameDataMap[G];
  readonly rawData?: GameRawDataMap[G];
  readonly sources: readonly QuerySource[];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

interface ProfileTaskSuccess<G extends ImplementedGame> {
  readonly ok: true;
  readonly complete: (durationMs: number) => QuerySuccess<G>;
}

type AnyProfileTaskSuccess = {
  readonly [G in ImplementedGame]: ProfileTaskSuccess<G>;
}[ImplementedGame];

type ProfileRunner<G extends ImplementedGame> = (
  options: A2sProfileOptions,
) => Promise<ProfileTaskSuccess<G>>;

type AnyProfileRunner = {
  readonly [G in ImplementedGame]: ProfileRunner<G>;
}[ImplementedGame];

type ProfileRunnerRegistry = {
  readonly [G in GameId]: G extends ImplementedGame ? ProfileRunner<G> : undefined;
};

type ProfileTaskResult = AnyProfileTaskSuccess | { readonly ok: false; readonly error: QueryError };

function createProfileRunner<G extends ImplementedGame>(
  game: G,
  queryProfile: (options: A2sProfileOptions) => Promise<GameProfileResult<G>>,
): ProfileRunner<G> {
  return async (options): Promise<ProfileTaskSuccess<G>> => {
    const profile = await queryProfile(options);
    return Object.freeze({
      ok: true,
      complete(durationMs: number): QuerySuccess<G> {
        return Object.freeze({
          ok: true,
          game,
          server: profile.server,
          data: profile.data,
          ...(profile.rawData === undefined ? {} : { rawData: profile.rawData }),
          sources: profile.sources,
          partial: profile.partial,
          warnings: profile.warnings,
          durationMs,
        });
      },
    });
  };
}

const PROFILE_RUNNERS: ProfileRunnerRegistry = Object.freeze({
  rust: createProfileRunner("rust", queryRustProfile),
  "project-zomboid": createProfileRunner("project-zomboid", queryProjectZomboidProfile),
  "7-days-to-die": createProfileRunner("7-days-to-die", querySevenDaysToDieProfile),
  "minecraft-java": undefined,
  "minecraft-bedrock": undefined,
  fivem: undefined,
});

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

function queryPort(input: QueryInput<GameId>): number {
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
  input: QueryInput<GameId>,
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

function observer(trace: SourceTrace): A2sProfileObserver {
  return {
    onSourceStarted(source): void {
      trace.started.add(source);
    },
    onSourceCompleted(report): void {
      trace.completed.set(report.source, report);
    },
  };
}

async function runProfileTask(
  runner: AnyProfileRunner,
  input: QueryInput<GameId>,
  mode: QueryMode,
  scope: ExecutionScope,
  trace: SourceTrace,
  dependencies: QueryDependencies,
): Promise<ProfileTaskResult> {
  try {
    const target = await pinnedTarget(input, dependencies);
    const options = {
      scope,
      target,
      mode,
      observer: observer(trace),
      ...(dependencies.a2s === undefined ? {} : { a2s: dependencies.a2s }),
    };
    return await runner(options);
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

/** Internal dependency-injected form of {@link query}; not exported from the package root. */
export async function queryWithDependencies(
  input: QueryInput,
  dependencies: QueryDependencies,
): Promise<QueryResult> {
  const normalizedInput: QueryInput<GameId> = { ...input, game: canonicalGameId(input.game) };
  const startedAt = dependencies.now();
  const runner = PROFILE_RUNNERS[normalizedInput.game];
  if (runner === undefined) {
    return failure(normalizedInput.game, UNSUPPORTED_ERROR, duration(startedAt, dependencies));
  }

  let timeoutMs: number;
  let mode: QueryMode;
  try {
    timeoutMs = normalizeTimeout(normalizedInput.timeoutMs);
    mode = normalizeMode(normalizedInput.mode);
    validateInput(normalizedInput);
  } catch {
    return failure(normalizedInput.game, INPUT_ERROR, duration(startedAt, dependencies));
  }

  const trace: SourceTrace = { started: new Set(), completed: new Map() };
  const execution = await executeWithDeadline(
    {
      timeoutMs,
      ...(normalizedInput.signal === undefined ? {} : { signal: normalizedInput.signal }),
    },
    (scope) => runProfileTask(runner, normalizedInput, mode, scope, trace, dependencies),
  );
  const durationMs = duration(startedAt, dependencies);
  if (!execution.ok) {
    return failure(
      normalizedInput.game,
      execution.error,
      durationMs,
      traceSources(trace, execution.error),
    );
  }
  if (!execution.value.ok) {
    return failure(
      normalizedInput.game,
      execution.value.error,
      durationMs,
      traceSources(trace, execution.value.error),
    );
  }
  return execution.value.complete(durationMs);
}

/** Queries one game server through its typed QueryHost profile. */
export function query<G extends GameInputId>(
  input: QueryInput<G>,
): Promise<QueryResult<CanonicalGameId<G>>> {
  return queryWithDependencies(input, DEFAULT_DEPENDENCIES) as Promise<
    QueryResult<CanonicalGameId<G>>
  >;
}
