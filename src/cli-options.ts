/** Strict command-line parsing for the QueryHost real-server probe. */

import type { GameId } from "./query.js";
import { canonicalGameId, isGameInputId } from "./registry.js";
import type { QueryMode } from "./shared.js";

const MAX_TIMEOUT_MS = 30_000;

/** Validated command-line options ready to become a public query input. */
export interface QueryCommandOptions {
  readonly game: GameId;
  readonly host: string;
  readonly port?: number;
  readonly queryPort?: number;
  readonly mode?: QueryMode;
  readonly timeoutMs?: number;
}

/** Complete parse outcome; CLI errors never throw parser implementation details. */
export type QueryCommandParseResult =
  | { readonly kind: "query"; readonly options: QueryCommandOptions }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

interface ParsedFlags {
  mode?: QueryMode;
  queryPort?: number;
  timeoutMs?: number;
}

function error(message: string): QueryCommandParseResult {
  return { kind: "error", message };
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

/** Parses `queryhost <game> <host> [port]` and its bounded optional flags. */
export function parseQueryArguments(args: readonly string[]): QueryCommandParseResult {
  if (args.includes("--help") || args.includes("-h")) {
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
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (argument !== "--mode" && argument !== "--query-port" && argument !== "--timeout") {
      return error(`Unsupported option: ${argument}`);
    }
    if (seen.has(argument)) {
      return error(`${argument} may only be provided once.`);
    }
    seen.add(argument);
    const value = flagValue(args, index, argument);
    if (typeof value !== "string") {
      return value;
    }
    index += 1;

    if (argument === "--mode") {
      if (value !== "summary" && value !== "full") {
        return error("--mode must be summary or full.");
      }
      flags.mode = value;
    } else if (argument === "--query-port") {
      const parsed = integer(value, "Query port", 65_535);
      if (typeof parsed !== "number") {
        return parsed;
      }
      flags.queryPort = parsed;
    } else {
      const parsed = integer(value, "Timeout", MAX_TIMEOUT_MS);
      if (typeof parsed !== "number") {
        return parsed;
      }
      flags.timeoutMs = parsed;
    }
  }

  if (positional.length < 2 || positional.length > 3) {
    return error("Expected a game, host, and optional port.");
  }
  const game = positional[0];
  const host = positional[1];
  if (game === undefined || !isGameInputId(game)) {
    return error(`Unsupported game: ${game ?? "(missing)"}`);
  }
  if (host === undefined || host.length === 0) {
    return error("Host must not be empty.");
  }
  const portValue = positional[2];
  const port = portValue === undefined ? undefined : integer(portValue, "Port", 65_535);
  if (port !== undefined && typeof port !== "number") {
    return port;
  }

  return {
    kind: "query",
    options: {
      game: canonicalGameId(game),
      host,
      ...(port === undefined ? {} : { port }),
      ...(flags.queryPort === undefined ? {} : { queryPort: flags.queryPort }),
      ...(flags.mode === undefined ? {} : { mode: flags.mode }),
      ...(flags.timeoutMs === undefined ? {} : { timeoutMs: flags.timeoutMs }),
    },
  };
}
