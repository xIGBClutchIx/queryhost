/** Eco profile over the dedicated server's web `/frontpage` status page. */

import type { EcoData, EcoRawData } from "../contracts/games.js";
import type {
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedTarget } from "../network/target.js";
import {
  plainEcoText,
  queryEcoFrontpage,
  type EcoFrontpage,
  type EcoQueryDependencies,
} from "../protocols/eco/frontpage.js";
import { raceAttempts } from "../runtime/attempt-race.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { HttpTransportError } from "../transports/http.js";

const QUERY_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface EcoProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the web-server destination. */
export interface EcoProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly observer: EcoProfileObserver;
  readonly query?: EcoQueryDependencies;
}

/** Fully interpreted Eco result before the public envelope is added. */
export interface EcoProfileResult {
  readonly server: ServerInfo;
  readonly data: EcoData;
  readonly rawData: EcoRawData;
  readonly sources: readonly [QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

function rootTermination(scope: ExecutionScope): HttpTransportError {
  return new HttpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

function serverInfo(page: EcoFrontpage, rttMs: number): ServerInfo {
  // TotalPlayers counts everyone who has joined the world, so it is not reported as `max`.
  return Object.freeze({
    ...(page.description === undefined ? {} : { name: plainEcoText(page.description) }),
    ...(page.version === undefined ? {} : { version: page.version }),
    ...(page.hasPassword === undefined ? {} : { password: page.hasPassword }),
    ...(page.onlinePlayers === undefined
      ? {}
      : { players: Object.freeze({ online: page.onlinePlayers }) }),
    queryRttMs: rttMs,
  });
}

function gameData(page: EcoFrontpage): EcoData {
  const {
    description: _description,
    detailedDescription,
    version: _version,
    hasPassword: _hasPassword,
    onlinePlayers: _onlinePlayers,
    onlinePlayerNames,
    ...facts
  } = page;
  return Object.freeze({
    ...(onlinePlayerNames === undefined ? {} : { players: onlinePlayerNames }),
    ...(detailedDescription === undefined
      ? {}
      : { detailedDescription: plainEcoText(detailedDescription) }),
    ...facts,
  });
}

function rawData(page: EcoFrontpage): EcoRawData {
  return Object.freeze({
    ...(page.description === undefined ? {} : { description: page.description }),
    ...(page.detailedDescription === undefined
      ? {}
      : { detailedDescription: page.detailedDescription }),
  });
}

/** Queries an Eco server's status page, racing validated addresses for the single source. */
export async function queryEcoProfile(options: EcoProfileOptions): Promise<EcoProfileResult> {
  options.observer.onSourceStarted("eco-frontpage");
  const { value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: QUERY_OPERATION_TIMEOUT_MS,
      source: "eco-frontpage",
      terminated: () => rootTermination(options.scope),
      empty: () => new HttpTransportError("CONNECTION_FAILED"),
    },
    (address, operation) =>
      queryEcoFrontpage({ scope: operation, target: options.target, address }, options.query),
  );
  const report: QuerySource = Object.freeze({
    source: "eco-frontpage",
    status: "ok",
    rttMs: result.rttMs,
  });
  options.observer.onSourceCompleted(report);
  const sources: readonly [QuerySource] = Object.freeze([report]);
  return Object.freeze({
    server: serverInfo(result.frontpage, result.rttMs),
    data: gameData(result.frontpage),
    rawData: rawData(result.frontpage),
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}
