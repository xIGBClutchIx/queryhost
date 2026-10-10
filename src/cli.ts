#!/usr/bin/env node
/** QueryHost command-line probe for fast real-server testing. */

import { parseQueryArguments } from "./cli/options.js";
import type { QueryInput } from "./contracts/query.js";
import { query } from "./runtime/client.js";
import { detect } from "./runtime/detect.js";

const HELP = `QueryHost game-server query probe

Usage:
  queryhost <game> <host> [port] [options]
  queryhost auto <host> [port] [options]
  npm run query -- <game> <host> [port] [options]

Use "auto" as the game to detect which supported game answers.

Options:
  --mode <full|summary>  Query all sources or only the required summary (default: full)
  --query-port <port>    Override the query port derived from the game port
  --timeout <ms>         Global deadline from 1 through 30000 (default: 5000)
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
  queryhost rust play.example.com --mode summary
  npm run query -- rust play.example.com 28015 --timeout 3000

The command prints the complete parsed QueryResult (DetectResult for auto) as JSON. Private, loopback,
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
    const common = {
      host: options.host,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal: cancellation.signal,
    };
    if (options.game === "auto") {
      const detected = await detect(common);
      process.stdout.write(`${JSON.stringify(detected, null, 2)}\n`);
      return detected.ok && detected.result.ok ? 0 : 1;
    }
    const input: QueryInput = {
      ...common,
      game: options.game,
      ...(options.queryPort === undefined ? {} : { queryPort: options.queryPort }),
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
