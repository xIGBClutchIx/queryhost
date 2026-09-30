/** Public query orchestration over validated targets and implemented game profiles. */

import {
  executeWithDeadline,
  OutboundAttemptLimitError,
  type ExecutionScope,
} from "./execution.js";
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
} from "../contracts/query.js";
import { canonicalGameId, GAME_REGISTRY } from "../contracts/registry.js";
import type {
  QueryError,
  QueryMode,
  QuerySource,
  QuerySourceName,
  QuerySourceStatus,
  QueryWarning,
  ServerInfo,
} from "../contracts/shared.js";
import {
  resolveTarget,
  validatePort,
  TargetResolutionError,
  createNodeDnsResolver,
  type DnsResolver,
  type PinnedTarget,
} from "../network/target.js";
import { UdpTransportError } from "../transports/udp.js";
import { TcpTransportError } from "../transports/tcp.js";
import { A2sProtocolError } from "../protocols/a2s/errors.js";
import type { A2sExchangeDependencies } from "../protocols/a2s/network.js";
import type { A2sProfileObserver, A2sProfileOptions } from "../profiles/a2s.js";
import { MinecraftJavaProtocolError } from "../protocols/minecraft-java/errors.js";
import { MinecraftBedrockProtocolError } from "../protocols/minecraft-bedrock/errors.js";
import type { MinecraftBedrockPingDependencies } from "../protocols/minecraft-bedrock/ping.js";
import type { MinecraftQueryDependencies } from "../protocols/minecraft-java/query.js";
import type { MinecraftJavaStatusDependencies } from "../protocols/minecraft-java/status.js";
import type { CfxQueryDependencies } from "../protocols/cfx/query.js";
import { queryMinecraftJavaProfile } from "../profiles/minecraft-java.js";
import { queryPalworldProfile } from "../profiles/palworld.js";
import { queryMinecraftBedrockProfile } from "../profiles/minecraft-bedrock.js";
import { queryProjectZomboidProfile } from "../profiles/project-zomboid.js";
import { queryRustProfile } from "../profiles/rust.js";
import { querySevenDaysToDieProfile } from "../profiles/seven-days-to-die.js";
import { queryValheimProfile } from "../profiles/valheim.js";
import { queryGenericA2sProfile } from "../profiles/generic-a2s.js";
import { CfxProfileError } from "../profiles/cfx.js";
import { queryFiveMProfile } from "../profiles/fivem.js";
import { queryRedMProfile } from "../profiles/redm.js";
import { querySatisfactoryProfile } from "../profiles/satisfactory.js";
import type { SatisfactoryQueryDependencies } from "../protocols/satisfactory/query.js";
import { SatisfactoryProtocolError } from "../protocols/satisfactory/errors.js";
import { VintageStoryProtocolError } from "../protocols/vintage-story/errors.js";
import type { VintageStoryQueryDependencies } from "../protocols/vintage-story/query.js";
import { queryVintageStoryProfile } from "../profiles/vintage-story.js";
import { queryArma3Profile } from "../profiles/arma-3.js";
import { queryDayZProfile } from "../profiles/dayz.js";
import { queryDontStarveTogetherProfile } from "../profiles/dont-starve-together.js";
import { querySteamA2sProfile } from "../profiles/steam-a2s.js";
import { querySoulmaskProfile } from "../profiles/soulmask.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const INPUT_ERROR: QueryError = Object.freeze({
  code: "INVALID_INPUT",
  message: "The query input is invalid.",
});

/** Injectable boundaries used by deterministic end-to-end profile tests. */
export interface QueryDependencies {
  readonly resolver?: DnsResolver;
  readonly a2s?: A2sExchangeDependencies;
  readonly minecraftJava?: MinecraftJavaStatusDependencies;
  readonly minecraftQuery?: MinecraftQueryDependencies;
  readonly minecraftBedrock?: MinecraftBedrockPingDependencies;
  readonly fivem?: CfxQueryDependencies;
  readonly redm?: CfxQueryDependencies;
  readonly satisfactory?: SatisfactoryQueryDependencies;
  readonly vintageStory?: VintageStoryQueryDependencies;
  readonly random?: () => number;
  readonly now: () => number;
}

interface SourceTrace {
  readonly started: Set<QuerySourceName>;
  readonly completed: Map<QuerySourceName, QuerySource>;
}

type ImplementedGame =
  | "a2s"
  | "dont-starve-together"
  | "rust"
  | "palworld"
  | "project-zomboid"
  | "7-days-to-die"
  | "dayz"
  | "valheim"
  | "minecraft-java"
  | "minecraft-bedrock"
  | "fivem"
  | "redm"
  | "satisfactory"
  | "vintage-story"
  | "counter-strike-2"
  | "counter-strike-source"
  | "team-fortress-2"
  | "left-4-dead"
  | "left-4-dead-2"
  | "garrys-mod"
  | "ark-survival-evolved"
  | "conan-exiles"
  | "killing-floor-2"
  | "day-of-dragons"
  | "soulmask"
  | "sons-of-the-forest"
  | "icarus"
  | "abiotic-factor"
  | "arma-3"
  | "american-truck-simulator"
  | "euro-truck-simulator-2"
  | "the-forest"
  | "unturned"
  | "enshrouded"
  | "insurgency-sandstorm";

interface ProfileRunOptions {
  readonly input: QueryInput<GameId>;
  readonly scope: ExecutionScope;
  readonly mode: QueryMode;
  readonly observer: A2sProfileObserver;
  readonly dependencies: QueryDependencies;
  readonly resolver: DnsResolver;
}

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
  options: ProfileRunOptions,
) => Promise<ProfileTaskSuccess<G>>;

interface ProfileRegistration<G extends ImplementedGame> {
  readonly runner: ProfileRunner<G>;
  readonly sources: readonly QuerySourceName[];
}

type AnyProfileRegistration = {
  readonly [G in ImplementedGame]: ProfileRegistration<G>;
}[ImplementedGame];

type ProfileRunnerRegistry = {
  readonly [G in GameId]: G extends ImplementedGame ? ProfileRegistration<G> : undefined;
};

type ProfileTaskResult = AnyProfileTaskSuccess | { readonly ok: false; readonly error: QueryError };

function createProfileRunner<G extends ImplementedGame>(
  game: G,
  sources: readonly QuerySourceName[],
  queryProfile: (options: ProfileRunOptions) => Promise<GameProfileResult<G>>,
): ProfileRegistration<G> {
  const runner: ProfileRunner<G> = async (options): Promise<ProfileTaskSuccess<G>> => {
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
  return Object.freeze({ runner, sources: Object.freeze([...sources]) });
}

const PROFILE_RUNNERS: ProfileRunnerRegistry = Object.freeze({
  a2s: createProfileRunner(
    "a2s",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryGenericA2sProfile),
  ),
  "dont-starve-together": createProfileRunner(
    "dont-starve-together",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryDontStarveTogetherProfile),
  ),
  rust: createProfileRunner(
    "rust",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryRustProfile),
  ),
  palworld: createProfileRunner(
    "palworld",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryPalworldProfile),
  ),
  "project-zomboid": createProfileRunner(
    "project-zomboid",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryProjectZomboidProfile),
  ),
  "7-days-to-die": createProfileRunner(
    "7-days-to-die",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(querySevenDaysToDieProfile),
  ),
  dayz: createProfileRunner(
    "dayz",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryDayZProfile),
  ),
  valheim: createProfileRunner(
    "valheim",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryValheimProfile),
  ),
  "minecraft-java": createProfileRunner(
    "minecraft-java",
    ["minecraft-srv", "minecraft-slp", "minecraft-query"],
    minecraftJavaProfileRunner,
  ),
  "minecraft-bedrock": createProfileRunner(
    "minecraft-bedrock",
    ["minecraft-bedrock-raknet"],
    minecraftBedrockProfileRunner,
  ),
  fivem: createProfileRunner(
    "fivem",
    ["fivem-info", "fivem-dynamic", "fivem-players"],
    fivemProfileRunner,
  ),
  redm: createProfileRunner(
    "redm",
    ["redm-info", "redm-dynamic", "redm-players"],
    redmProfileRunner,
  ),
  satisfactory: createProfileRunner(
    "satisfactory",
    ["satisfactory-lightweight", "satisfactory-health"],
    satisfactoryProfileRunner,
  ),
  "vintage-story": createProfileRunner(
    "vintage-story",
    ["vintage-story-query"],
    vintageStoryProfileRunner,
  ),
  "counter-strike-2": createProfileRunner(
    "counter-strike-2",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["counter-strike-2"].name }),
    ),
  ),
  "counter-strike-source": createProfileRunner(
    "counter-strike-source",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({
        ...options,
        gameName: GAME_REGISTRY["counter-strike-source"].name,
      }),
    ),
  ),
  "team-fortress-2": createProfileRunner(
    "team-fortress-2",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["team-fortress-2"].name }),
    ),
  ),
  "left-4-dead": createProfileRunner(
    "left-4-dead",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["left-4-dead"].name }),
    ),
  ),
  "left-4-dead-2": createProfileRunner(
    "left-4-dead-2",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["left-4-dead-2"].name }),
    ),
  ),
  "garrys-mod": createProfileRunner(
    "garrys-mod",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["garrys-mod"].name }),
    ),
  ),
  "ark-survival-evolved": createProfileRunner(
    "ark-survival-evolved",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["ark-survival-evolved"].name }),
    ),
  ),
  "conan-exiles": createProfileRunner(
    "conan-exiles",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({
        ...options,
        gameName: GAME_REGISTRY["conan-exiles"].name,
        // Conan Exiles never answers A2S Player, so querying it would only add a timeout.
        playerPolicy: "unsupported",
      }),
    ),
  ),
  "killing-floor-2": createProfileRunner(
    "killing-floor-2",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["killing-floor-2"].name }),
    ),
  ),
  "day-of-dragons": createProfileRunner(
    "day-of-dragons",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["day-of-dragons"].name }),
    ),
  ),
  soulmask: createProfileRunner(
    "soulmask",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(querySoulmaskProfile),
  ),
  "sons-of-the-forest": createProfileRunner(
    "sons-of-the-forest",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["sons-of-the-forest"].name }),
    ),
  ),
  icarus: createProfileRunner(
    "icarus",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["icarus"].name }),
    ),
  ),
  "abiotic-factor": createProfileRunner(
    "abiotic-factor",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["abiotic-factor"].name }),
    ),
  ),
  "arma-3": createProfileRunner(
    "arma-3",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner(queryArma3Profile),
  ),
  "american-truck-simulator": createProfileRunner(
    "american-truck-simulator",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({
        ...options,
        gameName: GAME_REGISTRY["american-truck-simulator"].name,
      }),
    ),
  ),
  "euro-truck-simulator-2": createProfileRunner(
    "euro-truck-simulator-2",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["euro-truck-simulator-2"].name }),
    ),
  ),
  "the-forest": createProfileRunner(
    "the-forest",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["the-forest"].name }),
    ),
  ),
  unturned: createProfileRunner(
    "unturned",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["unturned"].name }),
    ),
  ),
  enshrouded: createProfileRunner(
    "enshrouded",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["enshrouded"].name }),
    ),
  ),
  "insurgency-sandstorm": createProfileRunner(
    "insurgency-sandstorm",
    ["a2s-info", "a2s-player", "a2s-rules"],
    a2sProfileRunner((options) =>
      querySteamA2sProfile({ ...options, gameName: GAME_REGISTRY["insurgency-sandstorm"].name }),
    ),
  ),
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
  if (canonicalGameId(input.game) === "a2s" && input.port === undefined) {
    throw new RangeError("Generic A2S requires a query port.");
  }
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
  if (gamePort === undefined) {
    throw new RangeError("The selected profile has no default port.");
  }
  if (definition.defaultPort === undefined) {
    return validatePort(gamePort);
  }
  if (definition.queryPortStrategy === "fixed" && definition.defaultQueryPort !== undefined) {
    return validatePort(definition.defaultQueryPort);
  }
  const queryPortOffset =
    (definition.defaultQueryPort ?? definition.defaultPort) - definition.defaultPort;
  return validatePort(gamePort + queryPortOffset);
}

async function pinnedTarget(
  input: QueryInput<GameId>,
  scope: ExecutionScope,
  resolver: DnsResolver,
): Promise<PinnedTarget> {
  const targetInput = { host: input.host, port: queryPort(input) };
  return resolveTarget(targetInput, scope, resolver);
}

function a2sProfileRunner<G extends ImplementedGame>(
  queryProfile: (options: A2sProfileOptions) => Promise<GameProfileResult<G>>,
): (options: ProfileRunOptions) => Promise<GameProfileResult<G>> {
  return async (options): Promise<GameProfileResult<G>> =>
    queryProfile({
      scope: options.scope,
      target: await pinnedTarget(options.input, options.scope, options.resolver),
      mode: options.mode,
      observer: options.observer,
      ...(options.dependencies.a2s === undefined ? {} : { a2s: options.dependencies.a2s }),
    });
}

async function minecraftJavaProfileRunner(
  options: ProfileRunOptions,
): Promise<GameProfileResult<"minecraft-java">> {
  const input = options.input;
  return queryMinecraftJavaProfile({
    scope: options.scope,
    host: input.host,
    ...(input.port === undefined ? {} : { port: input.port }),
    ...(input.queryPort === undefined ? {} : { queryPort: input.queryPort }),
    mode: options.mode,
    observer: options.observer,
    resolver: options.resolver,
    ...(options.dependencies.random === undefined ? {} : { random: options.dependencies.random }),
    ...(options.dependencies.minecraftJava === undefined
      ? {}
      : { status: options.dependencies.minecraftJava }),
    ...(options.dependencies.minecraftQuery === undefined
      ? {}
      : { query: options.dependencies.minecraftQuery }),
  });
}

async function minecraftBedrockProfileRunner(
  options: ProfileRunOptions,
): Promise<GameProfileResult<"minecraft-bedrock">> {
  return queryMinecraftBedrockProfile({
    scope: options.scope,
    target: await pinnedTarget(options.input, options.scope, options.resolver),
    observer: options.observer,
    ...(options.dependencies.minecraftBedrock === undefined
      ? {}
      : { ping: options.dependencies.minecraftBedrock }),
    ...(options.dependencies.random === undefined ? {} : { random: options.dependencies.random }),
  });
}

async function fivemProfileRunner(options: ProfileRunOptions): Promise<GameProfileResult<"fivem">> {
  return queryFiveMProfile({
    scope: options.scope,
    target: await pinnedTarget(options.input, options.scope, options.resolver),
    mode: options.mode,
    observer: options.observer,
    ...(options.dependencies.fivem === undefined ? {} : { query: options.dependencies.fivem }),
  });
}

async function redmProfileRunner(options: ProfileRunOptions): Promise<GameProfileResult<"redm">> {
  return queryRedMProfile({
    scope: options.scope,
    target: await pinnedTarget(options.input, options.scope, options.resolver),
    mode: options.mode,
    observer: options.observer,
    ...(options.dependencies.redm === undefined ? {} : { query: options.dependencies.redm }),
  });
}

async function satisfactoryProfileRunner(
  options: ProfileRunOptions,
): Promise<GameProfileResult<"satisfactory">> {
  return querySatisfactoryProfile({
    scope: options.scope,
    target: await pinnedTarget(options.input, options.scope, options.resolver),
    mode: options.mode,
    observer: options.observer,
    ...(options.dependencies.satisfactory === undefined
      ? {}
      : { query: options.dependencies.satisfactory }),
    ...(options.dependencies.random === undefined ? {} : { random: options.dependencies.random }),
  });
}

async function vintageStoryProfileRunner(
  options: ProfileRunOptions,
): Promise<GameProfileResult<"vintage-story">> {
  return queryVintageStoryProfile({
    scope: options.scope,
    target: await pinnedTarget(options.input, options.scope, options.resolver),
    observer: options.observer,
    ...(options.dependencies.vintageStory === undefined
      ? {}
      : { query: options.dependencies.vintageStory }),
  });
}

function a2sProtocolError(error: A2sProtocolError): QueryError {
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

function minecraftJavaProtocolError(error: MinecraftJavaProtocolError): QueryError {
  const code = error.code;
  return {
    code,
    message:
      code === "RESPONSE_TOO_LARGE"
        ? "The Minecraft Java status response exceeded its size limit."
        : code === "INVALID_INPUT"
          ? "The Minecraft Java query input is invalid."
          : "The Minecraft Java status response was malformed.",
    source: "minecraft-slp",
  };
}

function minecraftBedrockProtocolError(error: MinecraftBedrockProtocolError): QueryError {
  return {
    code: error.code,
    message:
      error.code === "RESPONSE_TOO_LARGE"
        ? "The Minecraft Bedrock response exceeded its size limit."
        : error.code === "INVALID_INPUT"
          ? "The Minecraft Bedrock query input is invalid."
          : "The Minecraft Bedrock response was malformed.",
    source: "minecraft-bedrock-raknet",
  };
}

function udpErrorSource(trace: SourceTrace): QuerySourceName {
  if (trace.started.has("satisfactory-lightweight")) {
    return "satisfactory-lightweight";
  }
  if (trace.started.has("minecraft-bedrock-raknet")) {
    return "minecraft-bedrock-raknet";
  }
  return trace.started.has("minecraft-query") ? "minecraft-query" : "a2s-info";
}

function tcpErrorSource(trace: SourceTrace): QuerySourceName {
  return trace.started.has("vintage-story-query") ? "vintage-story-query" : "minecraft-slp";
}

function mapQueryError(error: Error, trace: SourceTrace): QueryError | undefined {
  if (error instanceof TargetResolutionError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof UdpTransportError) {
    return {
      code: error.code,
      message: error.message,
      source: udpErrorSource(trace),
    };
  }
  if (error instanceof TcpTransportError) {
    return { code: error.code, message: error.message, source: tcpErrorSource(trace) };
  }
  if (error instanceof A2sProtocolError) {
    return a2sProtocolError(error);
  }
  if (error instanceof MinecraftJavaProtocolError) {
    return minecraftJavaProtocolError(error);
  }
  if (error instanceof MinecraftBedrockProtocolError) {
    return minecraftBedrockProtocolError(error);
  }
  if (error instanceof VintageStoryProtocolError) {
    return {
      code: error.code,
      message: error.message,
      source: "vintage-story-query",
    };
  }
  if (error instanceof CfxProfileError) {
    return error.queryError;
  }
  if (error instanceof SatisfactoryProtocolError) {
    return {
      code: error.code,
      message:
        error.code === "RESPONSE_TOO_LARGE"
          ? "The Satisfactory response exceeded its size limit."
          : error.code === "INVALID_INPUT"
            ? "The Satisfactory query input is invalid."
            : "The Satisfactory response was malformed.",
      source: "satisfactory-lightweight",
    };
  }
  if (error instanceof OutboundAttemptLimitError) {
    return {
      code: "CONNECTION_FAILED",
      message: "The query exceeded its outbound attempt limit.",
    };
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

function traceSources(
  trace: SourceTrace,
  order: readonly QuerySourceName[],
  terminalError?: QueryError,
): readonly QuerySource[] {
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
  registration: AnyProfileRegistration,
  input: QueryInput<GameId>,
  mode: QueryMode,
  scope: ExecutionScope,
  trace: SourceTrace,
  dependencies: QueryDependencies,
  resolver: DnsResolver,
): Promise<ProfileTaskResult> {
  try {
    return await registration.runner({
      input,
      scope,
      mode,
      observer: observer(trace),
      dependencies,
      resolver,
    });
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const mapped = mapQueryError(error, trace);
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
  const registration = PROFILE_RUNNERS[normalizedInput.game];

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
  const resolver = dependencies.resolver ?? createNodeDnsResolver();
  const execution = await executeWithDeadline(
    {
      timeoutMs,
      ...(normalizedInput.signal === undefined ? {} : { signal: normalizedInput.signal }),
    },
    (scope) =>
      runProfileTask(registration, normalizedInput, mode, scope, trace, dependencies, resolver),
  );
  const durationMs = duration(startedAt, dependencies);
  if (!execution.ok) {
    return failure(
      normalizedInput.game,
      execution.error,
      durationMs,
      traceSources(trace, registration.sources, execution.error),
    );
  }
  if (!execution.value.ok) {
    return failure(
      normalizedInput.game,
      execution.value.error,
      durationMs,
      traceSources(trace, registration.sources, execution.value.error),
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
