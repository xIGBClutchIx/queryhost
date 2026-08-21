/** Minecraft Java-specific profile over one required Server List Ping source. */

import type { MinecraftJavaData } from "../games.js";
import type { ExecutionScope } from "../execution.js";
import {
  queryMinecraftStatus,
  type MinecraftJavaStatusDependencies,
  type MinecraftJavaStatusQueryResult,
} from "../protocols/minecraft-java/status.js";
import type { QuerySource, QuerySourceName, QueryWarning, ServerInfo } from "../shared.js";
import type { PinnedTarget } from "../target.js";
import { TcpTransportError } from "../transports/tcp.js";

const STATUS_OPERATION_TIMEOUT_MS = 2_000;

/** Source lifecycle observer used by whole-query provenance. */
export interface MinecraftJavaProfileObserver {
  readonly onSourceStarted: (source: QuerySourceName) => void;
  readonly onSourceCompleted: (report: QuerySource) => void;
}

/** Inputs available after the public query layer pins a Minecraft Java destination. */
export interface MinecraftJavaProfileOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly observer: MinecraftJavaProfileObserver;
  readonly minecraftJava?: MinecraftJavaStatusDependencies;
}

/** Fully merged Minecraft Java result before the public query envelope is added. */
export interface MinecraftJavaProfileResult {
  readonly server: ServerInfo;
  readonly data: MinecraftJavaData;
  readonly sources: readonly [QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: false;
}

function rootTermination(scope: ExecutionScope): TcpTransportError {
  return new TcpTransportError(scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED");
}

async function requiredStatus(
  options: MinecraftJavaProfileOptions,
): Promise<{ readonly result: MinecraftJavaStatusQueryResult; readonly report: QuerySource }> {
  const source = "minecraft-slp";
  options.observer.onSourceStarted(source);
  let lastError: Error | undefined;
  for (const address of options.target.addresses) {
    const operation = options.scope.createOperation(STATUS_OPERATION_TIMEOUT_MS, source);
    try {
      const result = await queryMinecraftStatus(
        { scope: operation, target: options.target, address },
        options.minecraftJava,
      );
      const report: QuerySource = Object.freeze({
        source,
        status: "ok",
        rttMs: result.rttMs,
      });
      options.observer.onSourceCompleted(report);
      return Object.freeze({ result, report });
    } catch (error) {
      if (options.scope.signal.aborted) {
        throw rootTermination(options.scope);
      }
      lastError = error instanceof Error ? error : new Error("Minecraft Java status failed.");
    } finally {
      operation.close();
    }
  }
  throw lastError ?? new Error("The pinned Minecraft Java target has no addresses.");
}

/** Queries Minecraft Java SLP and maps only confirmed status facts into public fields. */
export async function queryMinecraftJavaProfile(
  options: MinecraftJavaProfileOptions,
): Promise<MinecraftJavaProfileResult> {
  const status = await requiredStatus(options);
  const value = status.result.status;
  const server: ServerInfo = Object.freeze({
    version: value.versionName,
    players: Object.freeze({ online: value.playersOnline, max: value.playersMax }),
    queryRttMs: status.result.rttMs,
  });
  const data: MinecraftJavaData = Object.freeze({
    motd: value.motd,
    protocolVersion: value.protocolVersion,
    ...(value.favicon === undefined ? {} : { favicon: value.favicon }),
  });
  const sources: readonly [QuerySource] = Object.freeze([status.report]);
  return Object.freeze({
    server,
    data,
    sources,
    warnings: Object.freeze([]),
    partial: false,
  });
}
