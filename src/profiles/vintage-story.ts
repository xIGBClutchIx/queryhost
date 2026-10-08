/** Vintage Story profile over its direct dedicated-server query packet. */

import type { VintageStoryData } from "../contracts/games.js";
import type {
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedTarget } from "../network/target.js";
import {
  queryVintageStory,
  type VintageStoryQueryDependencies,
  type VintageStoryQueryResult,
} from "../protocols/vintage-story/query.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { raceAttempts } from "../runtime/attempt-race.js";
import { TcpTransportError } from "../transports/tcp.js";

const QUERY_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface VintageStoryProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the game destination. */
export interface VintageStoryProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly observer: VintageStoryProfileObserver;
  readonly query?: VintageStoryQueryDependencies;
}

/** Fully interpreted Vintage Story result before the public envelope is added. */
export interface VintageStoryProfileResult {
  readonly server: ServerInfo;
  readonly data: VintageStoryData;
  readonly sources: readonly [QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

function rootTermination(scope: ExecutionScope): TcpTransportError {
  return new TcpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function requiredQuery(
  options: VintageStoryProfileOptions,
): Promise<{ readonly result: VintageStoryQueryResult; readonly report: QuerySource }> {
  options.observer.onSourceStarted("vintage-story-query");
  const { value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: QUERY_OPERATION_TIMEOUT_MS,
      source: "vintage-story-query",
      terminated: () => rootTermination(options.scope),
      empty: () => new Error("Vintage Story target had no validated addresses."),
    },
    (address, operation) =>
      queryVintageStory({ scope: operation, target: options.target, address }, options.query),
  );
  const report: QuerySource = Object.freeze({
    source: "vintage-story-query",
    status: "ok",
    rttMs: result.rttMs,
  });
  options.observer.onSourceCompleted(report);
  return Object.freeze({ result, report });
}

/** Queries a Vintage Story server and preserves liveness-only responses without invented data. */
export async function queryVintageStoryProfile(
  options: VintageStoryProfileOptions,
): Promise<VintageStoryProfileResult> {
  const query = await requiredQuery(options);
  const answer = query.result.answer;
  const players =
    answer.playersOnline === undefined && answer.playersMax === undefined
      ? undefined
      : Object.freeze({
          ...(answer.playersOnline === undefined ? {} : { online: answer.playersOnline }),
          ...(answer.playersMax === undefined ? {} : { max: answer.playersMax }),
        });
  const sources: readonly [QuerySource] = Object.freeze([query.report]);
  return Object.freeze({
    server: Object.freeze({
      ...(answer.name === undefined ? {} : { name: answer.name }),
      ...(answer.version === undefined ? {} : { version: answer.version }),
      ...(answer.password === undefined ? {} : { password: answer.password }),
      ...(players === undefined ? {} : { players }),
      queryRttMs: query.result.rttMs,
    }),
    data: Object.freeze({
      response: answer.kind,
      ...(answer.motd === undefined ? {} : { motd: answer.motd }),
      ...(answer.gameMode === undefined ? {} : { gameMode: answer.gameMode }),
    }),
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}
