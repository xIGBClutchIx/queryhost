/** Process-independent command runner behind the `queryhost` executable. */

import type { DetectInput, DetectResult } from "../contracts/detect.js";
import type { QueryInput, QueryResult } from "../contracts/query.js";
import { canonicalGameId, GAME_ALIASES, isGameAlias, listGames } from "../contracts/registry.js";
import { parseQueryArguments } from "./options.js";

/** Exit status for a query or detection that resolved with a failure. */
export const EXIT_FAILURE = 1;
/** Exit status for an invalid invocation. */
export const EXIT_USAGE = 2;
/** Conventional exit status after Ctrl+C (128 + SIGINT). */
export const EXIT_INTERRUPTED = 130;

export const HELP = `QueryHost game-server query probe

Usage:
  queryhost <game> <host> [port] [options]
  queryhost auto <host> [port] [options]
  queryhost --list-games [--compact]
  npm run query -- <game> <host> [port] [options]

Use "auto" as the game to detect which supported game answers. Generic "a2s" has no default
port: give the server's A2S query port as [port] or --query-port.

Options:
  --mode <full|summary>  Query all sources or only the required summary (default: full)
  --query-port <port>    Override the query port derived from the game port
  --timeout <ms>         Global deadline from 1 through 30000 (default: 5000)
  --compact              Print single-line JSON
  --list-games           Print every game ID with its name and aliases
  -h, --help             Show this help

Examples:
  queryhost a2s play.example.com 27015
  queryhost auto play.example.com 28015
  queryhost dst play.example.com 10999 --query-port 27016
  queryhost rust play.example.com 28015
  queryhost cs2 play.example.com 27015
  queryhost gmod play.example.com 27015
  queryhost ark play.example.com 7777
  queryhost arma3 play.example.com 2302
  queryhost redm play.example.com 30120
  queryhost palworld play.example.com 8211
  queryhost dayz play.example.com 2302
  queryhost valheim play.example.com 2456
  queryhost mc play.example.com 25565
  queryhost satisfactory play.example.com 7777
  queryhost vs play.example.com 42420
  queryhost rust play.example.com --mode summary --compact
  npm run query -- rust play.example.com 28015 --timeout 3000

The command prints the complete parsed QueryResult (DetectResult for auto) as JSON. Private, loopback,
link-local, reserved, and other non-public destinations are blocked.

Exit status: 0 success, 1 query or detection failure, 2 invalid invocation, 130 interrupted.
`;

/** Side effects the runner needs, injected so it can be tested without a process or network. */
export interface CliEnvironment {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Aborted when the user interrupts the command. */
  readonly signal: AbortSignal;
  readonly query: (input: QueryInput) => Promise<QueryResult>;
  readonly detect: (input: DetectInput) => Promise<DetectResult>;
}

/** One `--list-games` row. */
interface ListedGame {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

function gameList(): readonly ListedGame[] {
  const aliases = new Map<string, string[]>();
  for (const alias of Object.keys(GAME_ALIASES)) {
    if (isGameAlias(alias)) {
      const game = canonicalGameId(alias);
      aliases.set(game, [...(aliases.get(game) ?? []), alias]);
    }
  }
  return listGames().map(({ id, name }) => ({ id, name, aliases: aliases.get(id) ?? [] }));
}

function json(value: QueryResult | DetectResult | readonly ListedGame[], compact: boolean): string {
  return `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`;
}

/** Runs one command and returns its exit status. Never throws for invalid arguments. */
export async function runCli(
  args: readonly string[],
  environment: CliEnvironment,
): Promise<number> {
  const parsed = parseQueryArguments(args);
  if (parsed.kind === "help") {
    environment.stdout(HELP);
    return 0;
  }
  if (parsed.kind === "error") {
    environment.stderr(`${parsed.message}\n\n${HELP}`);
    return EXIT_USAGE;
  }
  if (parsed.kind === "list-games") {
    environment.stdout(json(gameList(), parsed.compact));
    return 0;
  }

  const options = parsed.options;
  const common = {
    host: options.host,
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    signal: environment.signal,
  };
  let ok: boolean;
  if (options.game === "auto") {
    const detected = await environment.detect(common);
    environment.stdout(json(detected, options.compact));
    ok = detected.ok && detected.result.ok;
  } else {
    // The parser guarantees generic A2S a port and never gives it a query port.
    const input: QueryInput = {
      ...common,
      game: options.game,
      ...(options.queryPort === undefined ? {} : { queryPort: options.queryPort }),
    };
    const result = await environment.query(input);
    environment.stdout(json(result, options.compact));
    ok = result.ok;
  }
  if (environment.signal.aborted) {
    return EXIT_INTERRUPTED;
  }
  return ok ? 0 : EXIT_FAILURE;
}
