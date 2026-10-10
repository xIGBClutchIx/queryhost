/** Game detection by probing a bounded, registry-derived set of protocol and port pairs. */

import type {
  DetectError,
  DetectEvidence,
  DetectFailure,
  DetectInput,
  DetectProbe,
  DetectProtocol,
  DetectResult,
  DetectSuccess,
} from "../contracts/detect.js";
import type { GameId, QueryInput, QueryResult, QuerySuccess } from "../contracts/query.js";
import { GAME_IDS, GAME_REGISTRY } from "../contracts/registry.js";
import type { GameProtocol } from "../contracts/registry.js";
import type { QueryMode } from "../contracts/shared.js";
import {
  createNodeDnsResolver,
  validatePort,
  type DnsAddressRecord,
  type DnsSrvRecord,
  type DnsResolver,
} from "../network/target.js";
import { queryManyWith } from "./batch.js";
import { conventionalQueryPort, queryWithDependencies, type QueryDependencies } from "./client.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PROBES = 8;
const MAX_PROBES = 16;
/** Probes in flight at once, so a detection never bursts its whole probe budget at one host. */
const PROBE_CONCURRENCY = 4;
/** Share of the deadline held back from probing for the detected game's own query. */
const FINAL_QUERY_SHARE = 0.4;
const MAX_FINAL_QUERY_RESERVE_MS = 2_000;
/** A pair some game conventionally uses outranks any number of merely possible layouts. */
const CONVENTIONAL_WEIGHT = 4;
/** Steam game IDs keep the App ID in their low 24 bits. */
const GAME_ID_APP_MASK = 0xff_ffffn;

const INPUT_ERROR: DetectError = Object.freeze({
  code: "INVALID_INPUT",
  message: "The detection input is invalid.",
});
const ABORTED_ERROR: DetectError = Object.freeze({
  code: "ABORTED",
  message: "The detection was cancelled.",
});
const NOT_DETECTED_ERROR: DetectError = Object.freeze({
  code: "NOT_DETECTED",
  message: "No supported game answered at this host.",
});

/** One protocol and port pair with the games that conventionally answer there. */
interface PlannedProbe {
  readonly protocol: DetectProtocol;
  readonly port: number;
  /** Games for which this pair is the conventional query destination of the probed port. */
  readonly conventional: readonly GameId[];
  readonly weight: number;
  /** Registry position of the first game that proposed the pair, for a stable tie-break. */
  readonly rank: number;
}

interface PlanEntry {
  readonly protocol: DetectProtocol;
  readonly port: number;
  readonly conventional: Set<GameId>;
  possible: boolean;
  readonly rank: number;
}

interface Identification {
  readonly game: GameId;
  readonly evidence: DetectEvidence;
}

/** The profile each probe runs. It must answer for every game its protocol serves. */
type ProbeGame =
  | "a2s"
  | "minecraft-java"
  | "minecraft-bedrock"
  | "fivem"
  | "satisfactory"
  | "vintage-story"
  | "eco";

const PROBE_GAMES: { readonly [P in DetectProtocol]: ProbeGame } = Object.freeze({
  a2s: "a2s",
  "minecraft-java": "minecraft-java",
  "minecraft-bedrock": "minecraft-bedrock",
  cfx: "fivem",
  satisfactory: "satisfactory",
  "vintage-story": "vintage-story",
  eco: "eco",
});

function probeProtocol(protocol: GameProtocol): DetectProtocol {
  return protocol === "a2s-unreal" ? "a2s" : protocol;
}

function isPort(port: number): boolean {
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535;
}

/**
 * Derives every probe from the registry. Without a port each game contributes its conventional
 * query destination. With one, each game contributes the port read as its query port and the port
 * read as its game port; a fixed query port only counts when the port is that game's default.
 */
export function planProbes(port: number | undefined): readonly PlannedProbe[] {
  const entries = new Map<string, PlanEntry>();
  const add = (
    game: GameId,
    rank: number,
    protocol: DetectProtocol,
    probePort: number,
    conventional: boolean,
  ): void => {
    if (!isPort(probePort)) {
      return;
    }
    const key = `${protocol}:${probePort}`;
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = { protocol, port: probePort, conventional: new Set(), possible: false, rank };
      entries.set(key, entry);
    }
    if (conventional) {
      entry.conventional.add(game);
    } else {
      entry.possible = true;
    }
  };

  for (const [rank, game] of GAME_IDS.entries()) {
    const definition = GAME_REGISTRY[game];
    // Generic A2S has no convention to probe; an A2S answer of any game falls back to it.
    if (definition.defaultPort === undefined) {
      continue;
    }
    const protocol = probeProtocol(definition.protocol);
    const usualQueryPort = conventionalQueryPort(definition, definition.defaultPort);
    if (port === undefined) {
      add(game, rank, protocol, usualQueryPort, true);
      continue;
    }
    add(game, rank, protocol, port, usualQueryPort === port);
    if (definition.queryPortStrategy !== "fixed" || definition.defaultPort === port) {
      add(
        game,
        rank,
        protocol,
        conventionalQueryPort(definition, port),
        definition.defaultPort === port,
      );
    }
  }

  const distance = (probe: PlannedProbe): number =>
    port === undefined ? 0 : Math.abs(probe.port - port);
  const ranked = [...entries.values()]
    .map((entry): PlannedProbe =>
      Object.freeze({
        protocol: entry.protocol,
        port: entry.port,
        conventional: Object.freeze([...entry.conventional]),
        weight: entry.conventional.size * CONVENTIONAL_WEIGHT + (entry.possible ? 1 : 0),
        rank: entry.rank,
      }),
    )
    .sort(
      (a, b) =>
        b.weight - a.weight || distance(a) - distance(b) || a.rank - b.rank || a.port - b.port,
    );
  // Each protocol's best pair runs before any protocol's second, so a small budget still asks
  // every protocol once instead of spending itself on alternative A2S ports.
  const seen = new Set<DetectProtocol>();
  const firsts: PlannedProbe[] = [];
  const rest: PlannedProbe[] = [];
  for (const probe of ranked) {
    (seen.has(probe.protocol) ? rest : firsts).push(probe);
    seen.add(probe.protocol);
  }
  return Object.freeze([...firsts, ...rest]);
}

function probeInput(
  probe: PlannedProbe,
  host: string,
  callerPort: number | undefined,
  timeoutMs: number,
): QueryInput {
  const game = PROBE_GAMES[probe.protocol];
  const mode = probeMode(game);
  switch (game) {
    case "a2s":
      return { game, host, port: probe.port, mode, timeoutMs };
    case "minecraft-java":
      return { game, host, ...minecraftJavaPort(probe.port, callerPort), mode, timeoutMs };
    default:
      return { game, host, queryPort: probe.port, mode, timeoutMs };
  }
}

/**
 * Probes ask for the least each protocol needs to identify its game. Cfx needs `info.json`, which
 * only full mode reads, because its `gamename` variable is what tells FiveM and RedM apart.
 */
function probeMode(game: ProbeGame): QueryMode {
  return game === "fivem" ? "full" : "summary";
}

function a2sAppMatches(steamAppId: number, appId: number, full: boolean): boolean {
  // Without the 64-bit game ID only the 16-bit Info field is known, so compare what it kept.
  return full ? steamAppId === appId : (steamAppId & 0xffff) === appId;
}

function identifyA2s(result: QuerySuccess<"a2s">, conventional: readonly GameId[]): Identification {
  const { appId, steamGameId } = result.data;
  const advertised =
    steamGameId === undefined ? appId : Number(BigInt(steamGameId) & GAME_ID_APP_MASK);
  if (advertised !== undefined) {
    const matches = GAME_IDS.filter((game) => {
      const steamAppId = GAME_REGISTRY[game].steamAppId;
      return (
        steamAppId !== undefined && a2sAppMatches(steamAppId, advertised, steamGameId !== undefined)
      );
    });
    if (matches.length === 1 && matches[0] !== undefined) {
      return { game: matches[0], evidence: "advertised" };
    }
  }
  const byPort = conventional.filter(
    (game) => probeProtocol(GAME_REGISTRY[game].protocol) === "a2s",
  );
  if (byPort.length === 1 && byPort[0] !== undefined) {
    return { game: byPort[0], evidence: "port" };
  }
  return { game: "a2s", evidence: "fallback" };
}

/** Distributes over games, so switching on `game` narrows `data`. */
type AnyQuerySuccess = Extract<QueryResult, { readonly ok: true }>;

function identify(result: AnyQuerySuccess, probe: PlannedProbe): Identification {
  switch (result.game) {
    case "a2s":
      return identifyA2s(result, probe.conventional);
    case "fivem": {
      const gameName = result.data.variables?.["gamename"];
      if (gameName === "rdr3") {
        return { game: "redm", evidence: "advertised" };
      }
      return gameName === "gta5"
        ? { game: "fivem", evidence: "advertised" }
        : { game: "fivem", evidence: "fallback" };
    }
    default:
      return { game: result.game, evidence: "protocol" };
  }
}

function isResultFor<G extends GameId>(result: QueryResult, game: G): result is QueryResult<G> {
  return result.game === game;
}

/**
 * Minecraft's `port` is its Server List Ping port, while `queryPort` names its optional UDP Query.
 * Without a caller port it is omitted, so the profile's SRV discovery finds the server as usual.
 */
function minecraftJavaPort(
  probePort: number,
  callerPort: number | undefined,
): { readonly port?: number } {
  return callerPort === undefined ? {} : { port: probePort };
}

/** Input for the detected game's own query against the destination that answered. */
function finalInput(
  game: GameId,
  host: string,
  probePort: number,
  callerPort: number | undefined,
  mode: QueryMode,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): QueryInput {
  const common = { host, mode, timeoutMs, ...(signal === undefined ? {} : { signal }) };
  switch (game) {
    case "a2s":
      return { ...common, game, port: probePort };
    case "minecraft-java":
      return { ...common, game, ...minecraftJavaPort(probePort, callerPort) };
    default:
      return { ...common, game, queryPort: probePort };
  }
}

/**
 * Shares one lookup per name across every probe and the final query, so a detection resolves its
 * host and any SRV name once. A lookup belongs to the detection; each caller can still abandon it.
 */
function sharedResolver(base: DnsResolver, lifetime: AbortSignal): DnsResolver {
  const lookups = new Map<string, Promise<readonly DnsAddressRecord[]>>();
  const srvLookups = new Map<string, Promise<readonly DnsSrvRecord[]>>();
  return {
    resolveAddresses(hostname, signal): Promise<readonly DnsAddressRecord[]> {
      let lookup = lookups.get(hostname);
      if (lookup === undefined) {
        lookup = base.resolveAddresses(hostname, lifetime);
        // Each caller observes the shared promise; this keeps an unobserved rejection quiet.
        lookup.catch(() => undefined);
        lookups.set(hostname, lookup);
      }
      return untilAborted(lookup, signal);
    },
    resolveSrv(name, signal): Promise<readonly DnsSrvRecord[]> {
      let lookup = srvLookups.get(name);
      if (lookup === undefined) {
        lookup = base.resolveSrv(name, lifetime);
        lookup.catch(() => undefined);
        srvLookups.set(name, lookup);
      }
      return untilAborted(lookup, signal);
    },
  };
}

async function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let abandon: (() => void) | undefined;
  const abandoned = new Promise<never>((_resolve, reject) => {
    abandon = (): void => {
      reject(new DOMException("The lookup was abandoned.", "AbortError"));
    };
  });
  if (abandon === undefined) {
    return promise;
  }
  if (signal.aborted) {
    abandon();
  }
  signal.addEventListener("abort", abandon, { once: true });
  try {
    return await Promise.race([promise, abandoned]);
  } finally {
    signal.removeEventListener("abort", abandon);
  }
}

interface NormalizedDetectInput {
  readonly host: string;
  readonly port: number | undefined;
  readonly mode: QueryMode;
  readonly timeoutMs: number;
  readonly signal: AbortSignal | undefined;
  readonly maxProbes: number;
}

/** `detect()` is reachable from untyped JavaScript, so its declared input type is not a guarantee. */
type UntypedDetectInput = DetectInput | null | undefined;

function normalizeInput(input: UntypedDetectInput): NormalizedDetectInput | undefined {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }
  const host: string | number | object | null | undefined = input.host;
  const signal: AbortSignal | string | object | null | undefined = input.signal;
  const mode: string | undefined = input.mode;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxProbes = input.maxProbes ?? DEFAULT_MAX_PROBES;
  if (
    typeof host !== "string" ||
    (signal !== undefined && !(signal instanceof AbortSignal)) ||
    (mode !== undefined && mode !== "summary" && mode !== "full") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    !Number.isSafeInteger(maxProbes) ||
    maxProbes < 1 ||
    maxProbes > MAX_PROBES
  ) {
    return undefined;
  }
  try {
    if (input.port !== undefined) {
      validatePort(input.port);
    }
  } catch {
    return undefined;
  }
  return {
    host,
    port: input.port,
    mode: mode ?? "full",
    timeoutMs,
    signal,
    maxProbes,
  };
}

function failure(
  error: DetectError,
  probes: readonly DetectProbe[],
  durationMs: number,
): DetectFailure {
  return Object.freeze({ ok: false, error, probes: Object.freeze(probes), durationMs });
}

function success<G extends GameId>(
  game: G,
  evidence: DetectEvidence,
  result: QueryResult<G>,
  probes: readonly DetectProbe[],
  durationMs: number,
): DetectSuccess {
  // One game's fields, correlated by `G`, are exactly one member of the DetectSuccess union.
  return Object.freeze({
    ok: true,
    game,
    evidence,
    result,
    probes: Object.freeze(probes),
    durationMs,
  }) as DetectSuccess;
}

function probeReport(
  probe: PlannedProbe,
  outcome: QueryResult | undefined,
  matched: boolean,
  cancelled: boolean,
): DetectProbe {
  const { protocol, port } = probe;
  if (outcome === undefined) {
    return Object.freeze({ protocol, port, status: cancelled ? "cancelled" : "skipped" });
  }
  if (outcome.ok) {
    return Object.freeze({ protocol, port, status: matched ? "matched" : "answered" });
  }
  return Object.freeze({ protocol, port, status: "failed", error: outcome.error.code });
}

/** A failure every probe agrees on describes the host rather than any one protocol. */
function aggregateError(outcomes: readonly (QueryResult | undefined)[]): DetectError {
  const codes = new Set<string>();
  let shared: DetectError | undefined;
  for (const outcome of outcomes) {
    if (outcome === undefined || outcome.ok) {
      continue;
    }
    codes.add(outcome.error.code);
    const { code, message } = outcome.error;
    if (code === "DNS_FAILED" || code === "TARGET_BLOCKED" || code === "INVALID_INPUT") {
      shared = { code, message };
    }
  }
  return codes.size === 1 && shared !== undefined ? Object.freeze(shared) : NOT_DETECTED_ERROR;
}

/** Internal dependency-injected form of {@link detect}; not exported from the package root. */
export async function detectWithDependencies(
  input: DetectInput,
  dependencies: QueryDependencies,
): Promise<DetectResult> {
  const startedAt = dependencies.now();
  const elapsed = (): number => Math.max(0, dependencies.now() - startedAt);
  const options = normalizeInput(input);
  if (options === undefined) {
    return failure(INPUT_ERROR, [], elapsed());
  }

  const { host, maxProbes, port } = options;
  const plan = planProbes(port);
  const lifetime = new AbortController();
  const probeDependencies: QueryDependencies = {
    ...dependencies,
    resolver: sharedResolver(dependencies.resolver ?? createNodeDnsResolver(), lifetime.signal),
  };
  const reserve = Math.min(
    MAX_FINAL_QUERY_RESERVE_MS,
    Math.floor(options.timeoutMs * FINAL_QUERY_SHARE),
  );
  const probeBudget = options.timeoutMs - reserve;

  try {
    const outcomes: (QueryResult | undefined)[] = [];
    let pulled = 0;
    const budget = Math.min(maxProbes, plan.length);
    // Read lazily by the batch, so each probe gets only the probing time still left.
    function* probeInputs(): Generator<QueryInput, void, undefined> {
      for (const probe of plan.slice(0, budget)) {
        const remaining = Math.floor(probeBudget - elapsed());
        if (remaining < 1) {
          return;
        }
        pulled += 1;
        yield probeInput(probe, host, port, remaining);
      }
    }

    let matchIndex: number | undefined;
    const batch = queryManyWith(
      probeInputs(),
      {
        concurrency: PROBE_CONCURRENCY,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      (probe) => queryWithDependencies(probe, probeDependencies),
    );
    // Leaving the loop on the first answer cancels the probes still in flight and awaits cleanup.
    for await (const { index, result } of batch) {
      outcomes[index] = result;
      if (result.ok) {
        matchIndex = index;
        break;
      }
    }

    const reports = plan.map((probe, index) =>
      probeReport(probe, outcomes[index], index === matchIndex, index < pulled),
    );
    const match = matchIndex === undefined ? undefined : outcomes[matchIndex];
    const probe = matchIndex === undefined ? undefined : plan[matchIndex];
    if (options.signal?.aborted === true) {
      return failure(ABORTED_ERROR, reports, elapsed());
    }
    if (match === undefined || !match.ok || probe === undefined) {
      return failure(aggregateError(outcomes), reports, elapsed());
    }

    const { game, evidence } = identify(match, probe);
    if (game === match.game && probeMode(PROBE_GAMES[probe.protocol]) === options.mode) {
      // The probe already ran the detected game's profile in the requested mode.
      return isResultFor(match, game)
        ? success(game, evidence, match, reports, elapsed())
        : failure(NOT_DETECTED_ERROR, reports, elapsed());
    }
    const result = await queryWithDependencies(
      finalInput(
        game,
        options.host,
        probe.port,
        options.port,
        options.mode,
        Math.max(1, Math.floor(options.timeoutMs - elapsed())),
        options.signal,
      ),
      probeDependencies,
    );
    return isResultFor(result, game)
      ? success(game, evidence, result, reports, elapsed())
      : failure(NOT_DETECTED_ERROR, reports, elapsed());
  } finally {
    lifetime.abort();
  }
}

/**
 * Identifies which supported game a server runs, then queries it as that game.
 *
 * Probes are derived from `GAME_REGISTRY`: each distinct protocol and port pair the registry's
 * conventions allow for `port` (or, without one, every game's conventional query port) is ranked
 * by how many games use it, and at most `maxProbes` of them run, four at a time. The first probe
 * that answers decides the protocol; the server's advertised Steam App ID or Cfx `gamename`, or a
 * port only one game uses, then picks the game. The remaining probes are cancelled, and the
 * detected game's query reuses the probe's answer or the address it already resolved.
 *
 * Every planned probe is reported in `probes`, including those skipped by the budget. Invalid
 * input resolves as `INVALID_INPUT`, and a host where nothing answered as `NOT_DETECTED`.
 *
 * @example
 * ```ts
 * const detected = await detect({ host: "play.example.com", port: 27015 });
 * if (detected.ok && detected.result.ok) {
 *   console.log(detected.game, detected.result.server.name);
 * }
 * ```
 */
export function detect(input: DetectInput): Promise<DetectResult> {
  return detectWithDependencies(input, { now: (): number => performance.now() });
}
