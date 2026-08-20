#!/usr/bin/env node
/** QueryHost command-line probe for fast real-server testing. */

import { query } from "./client.js";
import { parseQueryArguments } from "./cli-options.js";
import type { QueryInput } from "./query.js";

const HELP = `QueryHost game-server query probe

Usage:
  queryhost <game> <host> [port] [options]
  npm run query -- <game> <host> [port] [options]

Options:
  --mode <full|summary>  Query all sources or only the required summary (default: full)
  --query-port <port>    Override the query port derived from the game port
  --timeout <ms>         Global deadline from 1 through 30000 (default: 5000)
  -h, --help             Show this help

Examples:
  queryhost rust play.example.com 28015
  queryhost rust play.example.com --mode summary
  npm run query -- rust play.example.com 28015 --timeout 3000

The command prints the complete parsed QueryResult as JSON. Private, loopback,
link-local, reserved, and other non-public destinations are blocked.
`;

function writeError(message: string): void {
  process.stderr.write(`${message}\n\n${HELP}`);
}

async function main(): Promise<number> {
  const parsed = parseQueryArguments(process.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.kind === "error") {
    writeError(parsed.message);
    return 2;
  }

  const cancellation = new AbortController();
  const cancel = (): void => {
    cancellation.abort();
  };
  process.once("SIGINT", cancel);
  try {
    const options = parsed.options;
    const input: QueryInput = {
      game: options.game,
      host: options.host,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.queryPort === undefined ? {} : { queryPort: options.queryPort }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal: cancellation.signal,
    };
    const result = await query(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } finally {
    process.off("SIGINT", cancel);
  }
}

try {
  process.exitCode = await main();
} catch {
  process.stderr.write("QueryHost could not complete the command.\n");
  process.exitCode = 1;
}
