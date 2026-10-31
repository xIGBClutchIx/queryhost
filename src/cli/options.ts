/** Strict command-line parsing for the QueryHost real-server probe. */

import type { GameId } from "../contracts/query.js";
import { canonicalGameId, isGameInputId, resolveQueryPort } from "../contracts/registry.js";
import type { QueryMode } from "../contracts/shared.js";

const MAX_TIMEOUT_MS = 30_000;

/** Validated command-line options ready to become a public query or detection input. */
export interface QueryCommandOptions {
  /** `auto` detects the game instead of querying a named one. */
  readonly game: GameId | "auto";
  readonly host: string;
  readonly port?: number;
  /** Never set for generic `a2s`, whose `--query-port` becomes `port`. */
  readonly queryPort?: number;
  readonly mode?: QueryMode;
  readonly timeoutMs?: number;
  /** Print single-line JSON instead of indented JSON. */
  readonly compact: boolean;
}

/** Complete parse outcome; CLI errors never throw parser implementation details. */
export type QueryCommandParseResult =
  | { readonly kind: "query"; readonly options: QueryCommandOptions }
  | { readonly kind: "list-games"; readonly compact: boolean }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

type ValueFlag = "--mode" | "--query-port" | "--timeout";
type SwitchFlag = "--compact" | "--list-games";

const VALUE_FLAGS: ReadonlySet<string> = new Set<ValueFlag>([
  "--mode",
  "--query-port",
  "--timeout",
]);
const SWITCH_FLAGS: ReadonlySet<string> = new Set<SwitchFlag>(["--compact", "--list-games"]);
const HELP_FLAGS: ReadonlySet<string> = new Set(["-h", "--help"]);

interface ParsedFlags {
  mode?: QueryMode;
  queryPort?: number;
  timeoutMs?: number;
  compact?: true;
  listGames?: true;
}

function error(message: string): QueryCommandParseResult {
  return { kind: "error", message };
}

function isValueFlag(argument: string): argument is ValueFlag {
  return VALUE_FLAGS.has(argument);
}

function integer(value: string, label: string, maximum: number): number | QueryCommandParseResult {
  if (!/^\d+$/u.test(value)) {
    return error(`${label} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    return error(`${label} must be between 1 and ${String(maximum)}.`);
  }
  return parsed;
}

function flagValue(
  args: readonly string[],
  index: number,
  flag: string,
): string | QueryCommandParseResult {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    return error(`${flag} requires a value.`);
  }
  return value;
}

/**
 * Help is requested only by `-h` or `--help` where an option may appear, so the same token used
 * as an option's value (`--mode -h`) is validated as that value instead.
 */
function requestsHelp(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      continue;
    }
    if (HELP_FLAGS.has(argument)) {
      return true;
    }
    if (isValueFlag(argument)) {
      index += 1;
    }
  }
  return false;
}

function applyValue(
  flags: ParsedFlags,
  flag: ValueFlag,
  value: string,
): QueryCommandParseResult | undefined {
  if (flag === "--mode") {
    if (value !== "summary" && value !== "full") {
      return error("--mode must be summary or full.");
    }
    flags.mode = value;
    return undefined;
  }
  const parsed =
    flag === "--query-port"
      ? integer(value, "Query port", 65_535)
      : integer(value, "Timeout", MAX_TIMEOUT_MS);
  if (typeof parsed !== "number") {
    return parsed;
  }
  if (flag === "--query-port") {
    flags.queryPort = parsed;
  } else {
    flags.timeoutMs = parsed;
  }
  return undefined;
}

/** Parses `queryhost <game|auto> <host> [port]`, `--list-games`, and their bounded flags. */
export function parseQueryArguments(args: readonly string[]): QueryCommandParseResult {
  if (requestsHelp(args)) {
    return { kind: "help" };
  }

  const positional: string[] = [];
  const flags: ParsedFlags = {};
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) {
      return error("The command arguments are invalid.");
    }
    if (!argument.startsWith("-")) {
      positional.push(argument);
      continue;
    }
    // Any other dash-prefixed token is an option, never a host or port.
    if (!isValueFlag(argument) && !SWITCH_FLAGS.has(argument)) {
      return error(`Unsupported option: ${argument}`);
    }
    if (seen.has(argument)) {
      return error(`${argument} may only be provided once.`);
    }
    seen.add(argument);
    if (argument === "--compact") {
      flags.compact = true;
      continue;
    }
    if (argument === "--list-games") {
      flags.listGames = true;
      continue;
    }
    if (!isValueFlag(argument)) {
      return error(`Unsupported option: ${argument}`);
    }
    const value = flagValue(args, index, argument);
    if (typeof value !== "string") {
      return value;
    }
    index += 1;
    const failed = applyValue(flags, argument, value);
    if (failed !== undefined) {
      return failed;
    }
  }

  const compact = flags.compact === true;
  if (flags.listGames === true) {
    if (
      positional.length > 0 ||
      flags.mode !== undefined ||
      flags.queryPort !== undefined ||
      flags.timeoutMs !== undefined
    ) {
      return error("--list-games accepts only --compact.");
    }
    return { kind: "list-games", compact };
  }

  if (positional.length < 2 || positional.length > 3) {
    return error("Expected a game, host, and optional port.");
  }
  const gameInput = positional[0];
  const host = positional[1];
  if (gameInput === undefined || (gameInput !== "auto" && !isGameInputId(gameInput))) {
    return error(`Unsupported game: ${gameInput ?? "(missing)"}`);
  }
  if (gameInput === "auto" && flags.queryPort !== undefined) {
    return error("--query-port cannot be combined with auto; pass the port to try instead.");
  }
  if (host === undefined || host.length === 0) {
    return error("Host must not be empty.");
  }
  const portValue = positional[2];
  const parsedPort = portValue === undefined ? undefined : integer(portValue, "Port", 65_535);
  if (parsedPort !== undefined && typeof parsedPort !== "number") {
    return parsedPort;
  }

  const game = gameInput === "auto" ? gameInput : canonicalGameId(gameInput);
  let port = parsedPort;
  let queryPort = flags.queryPort;
  if (game === "a2s") {
    // Generic A2S has no game port: its port is the A2S destination, so `--query-port` names the
    // same thing and is accepted in its place.
    if (port !== undefined && queryPort !== undefined && port !== queryPort) {
      return error("For a2s the port is the query port; pass one port or matching values.");
    }
    port ??= queryPort;
    queryPort = undefined;
    if (port === undefined) {
      return error("a2s requires the server's A2S query port, as [port] or --query-port.");
    }
  } else if (
    game !== "auto" &&
    resolveQueryPort(game, {
      ...(port === undefined ? {} : { port }),
      ...(queryPort === undefined ? {} : { queryPort }),
    }) === undefined
  ) {
    return error("The query port derived from that port is outside 1 to 65535; pass --query-port.");
  }

  return {
    kind: "query",
    options: {
      game,
      host,
      ...(port === undefined ? {} : { port }),
      ...(queryPort === undefined ? {} : { queryPort }),
      ...(flags.mode === undefined ? {} : { mode: flags.mode }),
      ...(flags.timeoutMs === undefined ? {} : { timeoutMs: flags.timeoutMs }),
      compact,
    },
  };
}
