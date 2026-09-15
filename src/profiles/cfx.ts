/** Shared Cfx profile over the three fixed public FXServer JSON endpoints. */

import type { CfxData, CfxPlayer } from "../contracts/games.js";
import type { ExecutionScope } from "../runtime/execution.js";
import {
  CfxEndpointError,
  queryCfxDynamic,
  queryCfxInfo,
  queryCfxPlayers,
  type CfxDynamic,
  type CfxEndpointDefinition,
  type CfxEndpointResult,
  type CfxInfo,
  type CfxQueryDependencies,
} from "../protocols/cfx/query.js";
import type {
  QueryError,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedAddress, PinnedTarget } from "../network/target.js";

const ENDPOINT_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface CfxProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the Cfx destination. */
export interface CfxProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly mode: QueryMode;
  readonly observer: CfxProfileObserver;
  readonly definition: CfxEndpointDefinition;
  readonly query?: CfxQueryDependencies;
}

/** Fully interpreted Cfx result before the public query envelope is added. */
export interface CfxProfileResult {
  readonly server: ServerInfo;
  readonly data: CfxData;
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

/** Failure used when none of the requested optional endpoints produced a usable server result. */
export class CfxProfileError extends Error {
  public override readonly name = "CfxProfileError";
  public readonly queryError: QueryError;

  public constructor(queryError: QueryError) {
    super(queryError.message);
    this.queryError = queryError;
  }
}

type EndpointOutcome<T> =
  | { readonly ok: true; readonly result: CfxEndpointResult<T> }
  | { readonly ok: false; readonly error: CfxEndpointError };

interface AddressOutcomes {
  readonly info: EndpointOutcome<CfxInfo> | undefined;
  readonly dynamic: EndpointOutcome<CfxDynamic>;
  readonly players: EndpointOutcome<readonly CfxPlayer[]> | undefined;
}

function frozenReport(source: QuerySourceName, outcome: EndpointOutcome<JsonFact>): QuerySource {
  return outcome.ok
    ? Object.freeze({ source, status: "ok", rttMs: outcome.result.rttMs })
    : Object.freeze({ source, status: outcome.error.status });
}

type JsonFact = CfxInfo | CfxDynamic | readonly CfxPlayer[];

async function endpoint<T>(work: () => Promise<CfxEndpointResult<T>>): Promise<EndpointOutcome<T>> {
  try {
    return Object.freeze({ ok: true, result: await work() });
  } catch (error) {
    if (error instanceof CfxEndpointError) {
      return Object.freeze({ ok: false, error });
    }
    throw error;
  }
}

function runEndpoint<T>(
  options: CfxProfileOptions,
  source: QuerySourceName,
  work: (scope: ExecutionScope) => Promise<CfxEndpointResult<T>>,
): Promise<EndpointOutcome<T>> {
  const operation = options.scope.createOperation(ENDPOINT_OPERATION_TIMEOUT_MS, source);
  return endpoint(() => work(operation)).finally((): void => {
    operation.close();
  });
}

async function queryAddress(
  options: CfxProfileOptions,
  address: PinnedAddress,
): Promise<AddressOutcomes> {
  const dependencies = options.query ?? {};
  const dynamic = runEndpoint(options, options.definition.sources.dynamic, (scope) =>
    queryCfxDynamic({ scope, target: options.target, address }, options.definition, dependencies),
  );
  if (options.mode === "summary") {
    return Object.freeze({ info: undefined, dynamic: await dynamic, players: undefined });
  }
  const info = runEndpoint(options, options.definition.sources.info, (scope) =>
    queryCfxInfo({ scope, target: options.target, address }, options.definition, dependencies),
  );
  const players = runEndpoint(options, options.definition.sources.players, (scope) =>
    queryCfxPlayers({ scope, target: options.target, address }, options.definition, dependencies),
  );
  const [infoResult, dynamicResult, playersResult] = await Promise.all([info, dynamic, players]);
  return Object.freeze({ info: infoResult, dynamic: dynamicResult, players: playersResult });
}

function anySuccess(outcomes: AddressOutcomes): boolean {
  return outcomes.dynamic.ok || outcomes.info?.ok === true || outcomes.players?.ok === true;
}

function firstError(options: CfxProfileOptions, outcomes: AddressOutcomes): CfxEndpointError {
  if (outcomes.info?.ok === false) {
    return outcomes.info.error;
  }
  if (!outcomes.dynamic.ok) {
    return outcomes.dynamic.error;
  }
  if (outcomes.players?.ok === false) {
    return outcomes.players.error;
  }
  return new CfxEndpointError(options.definition.sources.dynamic, "failed", {
    code: "CONNECTION_FAILED",
    message: `The ${options.definition.gameName} server did not provide a usable endpoint.`,
    source: options.definition.sources.dynamic,
  });
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
  if (source.status === "failed" || source.status === "unsupported") {
    return {
      code: "SOURCE_FAILED",
      message: `An optional ${gameName} query source failed.`,
      source: source.source,
    };
  }
  return undefined;
}

function warnings(
  definition: CfxEndpointDefinition,
  sources: readonly QuerySource[],
): readonly QueryWarning[] {
  const failed = sources.filter(
    (source) => source.status !== "ok" && source.status !== "not-requested",
  );
  if (failed.length === 0) {
    return Object.freeze([]);
  }
  const result: QueryWarning[] = [
    {
      code: "PARTIAL_RESULT",
      message: `One or more optional ${definition.gameName} query sources did not complete successfully.`,
    },
  ];
  for (const source of failed) {
    if (source.source === definition.sources.players) {
      result.push({
        code: "PLAYER_LIST_UNAVAILABLE",
        message: `The ${definition.gameName} player list is unavailable.`,
        source: source.source,
      });
    }
    const warning = sourceWarning(definition.gameName, source);
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

function gameData(outcomes: AddressOutcomes): CfxData {
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
export async function queryCfxProfile(options: CfxProfileOptions): Promise<CfxProfileResult> {
  options.observer.onSourceStarted(options.definition.sources.dynamic);
  if (options.mode === "full") {
    options.observer.onSourceStarted(options.definition.sources.info);
    options.observer.onSourceStarted(options.definition.sources.players);
  }

  let last: AddressOutcomes | undefined;
  for (const address of options.target.addresses) {
    last = await queryAddress(options, address);
    if (options.scope.signal.aborted) {
      throw new CfxProfileError(
        options.scope.getError() ?? {
          code: "ABORTED",
          message: `The ${options.definition.gameName} query was cancelled.`,
        },
      );
    }
    if (anySuccess(last)) {
      break;
    }
  }
  if (last === undefined) {
    throw new CfxProfileError({
      code: "CONNECTION_FAILED",
      message: `The ${options.definition.gameName} target had no validated addresses.`,
      source: options.definition.sources.dynamic,
    });
  }

  const infoReport =
    last.info === undefined
      ? notRequested(options.definition.sources.info)
      : frozenReport(options.definition.sources.info, last.info);
  const dynamicReport = frozenReport(options.definition.sources.dynamic, last.dynamic);
  const playersReport =
    last.players === undefined
      ? notRequested(options.definition.sources.players)
      : frozenReport(options.definition.sources.players, last.players);
  const sources: readonly [QuerySource, QuerySource, QuerySource] = Object.freeze([
    infoReport,
    dynamicReport,
    playersReport,
  ]);
  for (const report of sources) {
    options.observer.onSourceCompleted(report);
  }
  if (!anySuccess(last)) {
    throw new CfxProfileError(firstError(options, last).queryError);
  }
  const profileWarnings = warnings(options.definition, sources);
  return Object.freeze({
    server: serverInfo(last),
    data: gameData(last),
    sources,
    warnings: profileWarnings,
    partial: profileWarnings.length > 0,
  });
}
