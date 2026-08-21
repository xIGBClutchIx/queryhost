/** FiveM profile over its three fixed public JSON endpoints. */

import type { ExecutionScope } from "../execution.js";
import type { FiveMData, FiveMPlayer } from "../games.js";
import {
  FiveMEndpointError,
  queryFiveMDynamic,
  queryFiveMInfo,
  queryFiveMPlayers,
  type FiveMDynamic,
  type FiveMEndpointResult,
  type FiveMInfo,
  type FiveMQueryDependencies,
} from "../protocols/fivem/query.js";
import type {
  QueryError,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../shared.js";
import type { PinnedAddress, PinnedTarget } from "../target.js";

const ENDPOINT_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface FiveMProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the FiveM destination. */
export interface FiveMProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly mode: QueryMode;
  readonly observer: FiveMProfileObserver;
  readonly query?: FiveMQueryDependencies;
}

/** Fully interpreted FiveM result before the public query envelope is added. */
export interface FiveMProfileResult {
  readonly server: ServerInfo;
  readonly data: FiveMData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

/** Failure used when none of the requested optional endpoints produced a usable server result. */
export class FiveMProfileError extends Error {
  public override readonly name = "FiveMProfileError";
  public readonly queryError: QueryError;

  public constructor(queryError: QueryError) {
    super(queryError.message);
    this.queryError = queryError;
  }
}

type EndpointOutcome<T> =
  | { readonly ok: true; readonly result: FiveMEndpointResult<T> }
  | { readonly ok: false; readonly error: FiveMEndpointError };

interface AddressOutcomes {
  readonly info: EndpointOutcome<FiveMInfo> | undefined;
  readonly dynamic: EndpointOutcome<FiveMDynamic>;
  readonly players: EndpointOutcome<readonly FiveMPlayer[]> | undefined;
}

function frozenReport(source: QuerySourceName, outcome: EndpointOutcome<JsonFact>): QuerySource {
  return outcome.ok
    ? Object.freeze({ source, status: "ok", rttMs: outcome.result.rttMs })
    : Object.freeze({ source, status: outcome.error.status });
}

type JsonFact = FiveMInfo | FiveMDynamic | readonly FiveMPlayer[];

async function endpoint<T>(
  work: () => Promise<FiveMEndpointResult<T>>,
): Promise<EndpointOutcome<T>> {
  try {
    return Object.freeze({ ok: true, result: await work() });
  } catch (error) {
    if (error instanceof FiveMEndpointError) {
      return Object.freeze({ ok: false, error });
    }
    throw error;
  }
}

function runEndpoint<T>(
  options: FiveMProfileOptions,
  source: QuerySourceName,
  work: (scope: ExecutionScope) => Promise<FiveMEndpointResult<T>>,
): Promise<EndpointOutcome<T>> {
  const operation = options.scope.createOperation(ENDPOINT_OPERATION_TIMEOUT_MS, source);
  return endpoint(() => work(operation)).finally((): void => {
    operation.close();
  });
}

async function queryAddress(
  options: FiveMProfileOptions,
  address: PinnedAddress,
): Promise<AddressOutcomes> {
  const dependencies = options.query ?? {};
  const dynamic = runEndpoint(options, "fivem-dynamic", (scope) =>
    queryFiveMDynamic({ scope, target: options.target, address }, dependencies),
  );
  if (options.mode === "summary") {
    return Object.freeze({ info: undefined, dynamic: await dynamic, players: undefined });
  }
  const info = runEndpoint(options, "fivem-info", (scope) =>
    queryFiveMInfo({ scope, target: options.target, address }, dependencies),
  );
  const players = runEndpoint(options, "fivem-players", (scope) =>
    queryFiveMPlayers({ scope, target: options.target, address }, dependencies),
  );
  const [infoResult, dynamicResult, playersResult] = await Promise.all([info, dynamic, players]);
  return Object.freeze({ info: infoResult, dynamic: dynamicResult, players: playersResult });
}

function anySuccess(outcomes: AddressOutcomes): boolean {
  return outcomes.dynamic.ok || outcomes.info?.ok === true || outcomes.players?.ok === true;
}

function firstError(outcomes: AddressOutcomes): FiveMEndpointError {
  if (outcomes.info?.ok === false) {
    return outcomes.info.error;
  }
  if (!outcomes.dynamic.ok) {
    return outcomes.dynamic.error;
  }
  if (outcomes.players?.ok === false) {
    return outcomes.players.error;
  }
  return new FiveMEndpointError("fivem-dynamic", "failed", {
    code: "CONNECTION_FAILED",
    message: "The FiveM server did not provide a usable endpoint.",
    source: "fivem-dynamic",
  });
}

function sourceWarning(source: QuerySource): QueryWarning | undefined {
  if (source.status === "timeout") {
    return {
      code: "SOURCE_TIMEOUT",
      message: "An optional FiveM query source timed out.",
      source: source.source,
    };
  }
  if (source.status === "blocked") {
    return {
      code: "SOURCE_BLOCKED",
      message: "An optional FiveM query source was blocked.",
      source: source.source,
    };
  }
  if (source.status === "malformed") {
    return {
      code: "SOURCE_MALFORMED",
      message: "An optional FiveM query source returned malformed data.",
      source: source.source,
    };
  }
  if (source.status === "failed" || source.status === "unsupported") {
    return {
      code: "SOURCE_FAILED",
      message: "An optional FiveM query source failed.",
      source: source.source,
    };
  }
  return undefined;
}

function warnings(sources: readonly QuerySource[]): readonly QueryWarning[] {
  const failed = sources.filter(
    (source) => source.status !== "ok" && source.status !== "not-requested",
  );
  if (failed.length === 0) {
    return Object.freeze([]);
  }
  const result: QueryWarning[] = [
    {
      code: "PARTIAL_RESULT",
      message: "One or more optional FiveM query sources did not complete successfully.",
    },
  ];
  for (const source of failed) {
    if (source.source === "fivem-players") {
      result.push({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: "The FiveM player list is unavailable.",
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

function notRequested(source: QuerySourceName): QuerySource {
  return Object.freeze({ source, status: "not-requested" });
}

function serverInfo(outcomes: AddressOutcomes): ServerInfo {
  const info = outcomes.info?.ok === true ? outcomes.info.result.value : undefined;
  const dynamic = outcomes.dynamic.ok ? outcomes.dynamic.result.value : undefined;
  const players =
    dynamic?.clients === undefined && dynamic?.maxClients === undefined
      ? undefined
      : Object.freeze({
          ...(dynamic.clients === undefined ? {} : { online: dynamic.clients }),
          ...(dynamic.maxClients === undefined ? {} : { max: dynamic.maxClients }),
        });
  const queryRttMs = outcomes.dynamic.ok
    ? outcomes.dynamic.result.rttMs
    : outcomes.info?.ok === true
      ? outcomes.info.result.rttMs
      : outcomes.players?.ok === true
        ? outcomes.players.result.rttMs
        : undefined;
  return Object.freeze({
    ...(dynamic?.hostname === undefined ? {} : { name: dynamic.hostname }),
    ...(dynamic?.mapName === undefined ? {} : { map: dynamic.mapName }),
    ...(info?.server === undefined ? {} : { version: info.server }),
    ...(players === undefined ? {} : { players }),
    ...(queryRttMs === undefined ? {} : { queryRttMs }),
  });
}

function gameData(outcomes: AddressOutcomes): FiveMData {
  const info = outcomes.info?.ok === true ? outcomes.info.result.value : undefined;
  const dynamic = outcomes.dynamic.ok ? outcomes.dynamic.result.value : undefined;
  const players = outcomes.players?.ok === true ? outcomes.players.result.value : undefined;
  return Object.freeze({
    ...(info?.resources === undefined ? {} : { resources: info.resources }),
    ...(info?.variables === undefined ? {} : { variables: info.variables }),
    ...(players === undefined ? {} : { players }),
    ...(dynamic?.gameType === undefined ? {} : { gameType: dynamic.gameType }),
    ...(info?.oneSyncEnabled === undefined ? {} : { oneSyncEnabled: info.oneSyncEnabled }),
    ...(info?.enhancedHostSupport === undefined
      ? {}
      : { enhancedHostSupport: info.enhancedHostSupport }),
  });
}

/** Queries one pinned backend, running all full-mode endpoints concurrently. */
export async function queryFiveMProfile(options: FiveMProfileOptions): Promise<FiveMProfileResult> {
  options.observer.onSourceStarted("fivem-dynamic");
  if (options.mode === "full") {
    options.observer.onSourceStarted("fivem-info");
    options.observer.onSourceStarted("fivem-players");
  }

  let last: AddressOutcomes | undefined;
  for (const address of options.target.addresses) {
    last = await queryAddress(options, address);
    if (options.scope.signal.aborted) {
      throw new FiveMProfileError(
        options.scope.getError() ?? {
          code: "ABORTED",
          message: "The FiveM query was cancelled.",
        },
      );
    }
    if (anySuccess(last)) {
      break;
    }
  }
  if (last === undefined) {
    throw new FiveMProfileError({
      code: "CONNECTION_FAILED",
      message: "The FiveM target had no validated addresses.",
      source: "fivem-dynamic",
    });
  }

  const infoReport =
    last.info === undefined ? notRequested("fivem-info") : frozenReport("fivem-info", last.info);
  const dynamicReport = frozenReport("fivem-dynamic", last.dynamic);
  const playersReport =
    last.players === undefined
      ? notRequested("fivem-players")
      : frozenReport("fivem-players", last.players);
  const sources: readonly [QuerySource, QuerySource, QuerySource] = Object.freeze([
    infoReport,
    dynamicReport,
    playersReport,
  ]);
  for (const report of sources) {
    options.observer.onSourceCompleted(report);
  }
  if (!anySuccess(last)) {
    throw new FiveMProfileError(firstError(last).queryError);
  }
  const profileWarnings = warnings(sources);
  return Object.freeze({
    server: serverInfo(last),
    data: gameData(last),
    sources,
    warnings: profileWarnings,
    partial: profileWarnings.length > 0,
  });
}
