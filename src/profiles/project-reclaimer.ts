/** Project Reclaimer profile over the server-browser status exchange on the UDP game port. */

import type { ProjectReclaimerData } from "../contracts/games.js";
import type {
  QuerySource,
  QuerySourceName,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import type { PinnedTarget } from "../network/target.js";
import {
  queryProjectReclaimerStatus,
  type ProjectReclaimerQueryDependencies,
  type ProjectReclaimerStatus,
} from "../protocols/project-reclaimer/status.js";
import { raceAttempts } from "../runtime/attempt-race.js";
import type { ExecutionScope } from "../runtime/execution.js";
import { QuicTransportError } from "../transports/quic.js";

/** A QUIC handshake plus one request takes two round trips, and a lost packet costs a probe. */
const QUERY_OPERATION_TIMEOUT_MS = 2_500;

/** Source lifecycle observer used by whole-query provenance. */
export interface ProjectReclaimerProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public layer validates and pins the game-port destination. */
export interface ProjectReclaimerProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly observer: ProjectReclaimerProfileObserver;
  readonly query?: ProjectReclaimerQueryDependencies;
}

/** Fully interpreted Project Reclaimer result before the public envelope is added. */
export interface ProjectReclaimerProfileResult {
  readonly server: ServerInfo;
  readonly data: ProjectReclaimerData;
  readonly sources: readonly [QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

function rootTermination(scope: ExecutionScope): QuicTransportError {
  return new QuicTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

function serverInfo(status: ProjectReclaimerStatus, rttMs: number): ServerInfo {
  const players = {
    ...(status.players === undefined ? {} : { online: status.players }),
    ...(status.capacity === undefined ? {} : { max: status.capacity }),
  };
  return Object.freeze({
    ...(status.name === undefined ? {} : { name: status.name }),
    ...(status.map === undefined ? {} : { map: status.map }),
    ...(status.version === undefined ? {} : { version: status.version }),
    ...(status.passwordRequired === undefined ? {} : { password: status.passwordRequired }),
    ...(Object.keys(players).length === 0 ? {} : { players: Object.freeze(players) }),
    queryRttMs: rttMs,
  });
}

function gameData(status: ProjectReclaimerStatus): ProjectReclaimerData {
  const {
    name: _name,
    map: _map,
    version: _version,
    passwordRequired: _passwordRequired,
    players: _players,
    capacity: _capacity,
    playerNames,
    ...facts
  } = status;
  return Object.freeze({
    ...facts,
    ...(playerNames === undefined ? {} : { players: playerNames }),
  });
}

/** Queries a Project Reclaimer server, racing validated addresses for the single source. */
export async function queryProjectReclaimerProfile(
  options: ProjectReclaimerProfileOptions,
): Promise<ProjectReclaimerProfileResult> {
  options.observer.onSourceStarted("project-reclaimer-status");
  const { value: result } = await raceAttempts(
    {
      scope: options.scope,
      candidates: options.target.addresses,
      operationTimeoutMs: QUERY_OPERATION_TIMEOUT_MS,
      source: "project-reclaimer-status",
      terminated: () => rootTermination(options.scope),
      empty: () => new QuicTransportError("CONNECTION_FAILED"),
    },
    (address, operation) =>
      queryProjectReclaimerStatus(
        { scope: operation, target: options.target, address },
        options.query,
      ),
  );
  const report: QuerySource = Object.freeze({
    source: "project-reclaimer-status",
    status: "ok",
    rttMs: result.rttMs,
  });
  options.observer.onSourceCompleted(report);
  const sources: readonly [QuerySource] = Object.freeze([report]);
  return Object.freeze({
    server: serverInfo(result.status, result.rttMs),
    data: gameData(result.status),
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}
